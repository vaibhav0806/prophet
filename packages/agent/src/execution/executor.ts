import type { ArbitOpportunity } from "../types.js";
import type { VaultClient } from "./vault-client.js";
import type { Config } from "../config.js";

export class Executor {
  private vaultClient: VaultClient;
  private config: Config;

  constructor(vaultClient: VaultClient, config: Config) {
    this.vaultClient = vaultClient;
    this.config = config;
  }

  async executeBest(opportunity: ArbitOpportunity, maxPositionSize: bigint): Promise<void> {
    // Split maxPositionSize evenly between A and B sides
    const amountPerSide = maxPositionSize / 2n;

    // Check vault balance before trading
    const vaultBalance = await this.vaultClient.getVaultBalance();
    const totalNeeded = amountPerSide * 2n;
    if (vaultBalance < totalNeeded) {
      console.log(`[Executor] Insufficient vault balance: ${vaultBalance} < ${totalNeeded}`);
      return;
    }

    // Estimate gas cost for profitability check
    try {
      const gasPrice = await this.vaultClient.publicClient.getGasPrice();
      // openPosition typically uses ~400k gas
      const estimatedGasCost = gasPrice * 400_000n;

      // Convert gas cost (in native token wei) to approximate USDT value
      // gasToUsdtRate = native token price in 6-decimal USDT (e.g., $3000 ETH = 3000_000_000n)
      const gasCostUsdt = (estimatedGasCost * this.config.gasToUsdtRate) / BigInt(1e18);

      if (opportunity.estProfit <= gasCostUsdt) {
        console.log(`[Executor] Trade unprofitable after gas: profit=${opportunity.estProfit}, gasCost=${gasCostUsdt}`);
        return;
      }
    } catch (e) {
      console.warn('[Executor] Gas estimation failed, proceeding anyway:', e);
    }

    console.log(
      `[Executor] Executing arb: ${opportunity.protocolA} vs ${opportunity.protocolB}`,
    );
    console.log(
      `[Executor] Spread: ${opportunity.spreadBps} bps, buyYesOnA: ${opportunity.buyYesOnA}`,
    );
    console.log(`[Executor] Amount per side: ${amountPerSide}`);

    // Slippage protection: expect at least 95% of estimated shares
    const minSharesA =
      opportunity.yesPriceA > 0n
        ? (amountPerSide * BigInt(1e18)) / opportunity.yesPriceA * 95n / 100n
        : 0n;
    const minSharesB =
      opportunity.noPriceB > 0n
        ? (amountPerSide * BigInt(1e18)) / opportunity.noPriceB * 95n / 100n
        : 0n;

    try {
      const positionId = await this.vaultClient.openPosition({
        adapterA: this.config.adapterAAddress,
        adapterB: this.config.adapterBAddress,
        marketIdA: this.config.marketId,
        marketIdB: this.config.marketId,
        buyYesOnA: opportunity.buyYesOnA,
        amountA: amountPerSide,
        amountB: amountPerSide,
        minSharesA,
        minSharesB,
      });

      console.log(`[Executor] Position opened: #${positionId}`);
    } catch (err) {
      console.error("[Executor] Failed to execute trade:", err);
      throw err;
    }
  }
}
