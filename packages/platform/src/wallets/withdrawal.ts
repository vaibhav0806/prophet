import { createWalletClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Database } from "@prophit/shared/db";
import { withdrawals } from "@prophit/shared/db";
import { eq } from "drizzle-orm";
import type { KeyVault } from "./key-vault.js";

const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`;

const erc20TransferAbi = [
  {
    type: "function" as const,
    name: "transfer" as const,
    inputs: [
      { name: "to" as const, type: "address" as const },
      { name: "amount" as const, type: "uint256" as const },
    ],
    outputs: [{ name: "" as const, type: "bool" as const }],
    stateMutability: "nonpayable" as const,
  },
] as const;

export class WithdrawalProcessor {
  private readonly db: Database;
  private readonly keyVault: KeyVault;
  private readonly rpcUrl: string;
  private readonly chainId: number;

  constructor(params: {
    db: Database;
    keyVault: KeyVault;
    rpcUrl: string;
    chainId: number;
  }) {
    this.db = params.db;
    this.keyVault = params.keyVault;
    this.rpcUrl = params.rpcUrl;
    this.chainId = params.chainId;
  }

  /**
   * Process a pending withdrawal request.
   */
  async processWithdrawal(withdrawalId: string): Promise<{ txHash: string }> {
    // Get the withdrawal record
    const [withdrawal] = await this.db.select()
      .from(withdrawals)
      .where(eq(withdrawals.id, withdrawalId))
      .limit(1);

    if (!withdrawal) throw new Error("Withdrawal not found");
    if (withdrawal.status !== "pending") throw new Error(`Withdrawal status is ${withdrawal.status}, expected pending`);

    // Mark as processing
    await this.db.update(withdrawals)
      .set({ status: "processing" })
      .where(eq(withdrawals.id, withdrawalId));

    try {
      // Get user's private key
      const privateKey = await this.keyVault.getPrivateKey(withdrawal.userId);
      if (!privateKey) throw new Error("No trading wallet found for user");

      const chain = defineChain({
        id: this.chainId,
        name: this.chainId === 56 ? "BNB Smart Chain" : "prophit-chain",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: { default: { http: [this.rpcUrl] } },
      });

      const account = privateKeyToAccount(privateKey);
      const walletClient = createWalletClient({
        account,
        chain,
        transport: http(this.rpcUrl, { timeout: 30_000 }),
      });

      let txHash: string;

      if (withdrawal.token === "BNB") {
        // Send BNB
        txHash = await walletClient.sendTransaction({
          to: withdrawal.toAddress as `0x${string}`,
          value: withdrawal.amount,
          chain,
        });
      } else {
        // Send USDT (ERC-20 transfer)
        txHash = await walletClient.writeContract({
          address: BSC_USDT,
          abi: erc20TransferAbi,
          functionName: "transfer",
          args: [withdrawal.toAddress as `0x${string}`, withdrawal.amount],
          chain,
        });
      }

      // Mark as confirmed
      await this.db.update(withdrawals)
        .set({ status: "confirmed", txHash, processedAt: new Date() })
        .where(eq(withdrawals.id, withdrawalId));

      console.log(`[Withdrawal] Processed ${withdrawal.token} withdrawal ${withdrawalId}: ${txHash}`);
      return { txHash };
    } catch (err) {
      // Mark as failed
      await this.db.update(withdrawals)
        .set({ status: "failed", processedAt: new Date() })
        .where(eq(withdrawals.id, withdrawalId));

      console.error(`[Withdrawal] Failed to process ${withdrawalId}:`, err);
      throw err;
    }
  }
}
