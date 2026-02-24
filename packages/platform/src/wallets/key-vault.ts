import { encryptPrivateKey, decryptPrivateKey, deriveMasterKey } from "@prophit/shared/crypto";
import type { Database } from "@prophit/shared/db";
import { tradingWallets } from "@prophit/shared/db";
import { eq } from "drizzle-orm";
import { deriveWallet, seedFromMnemonic, seedFromHex } from "./hd-wallet.js";

export class KeyVault {
  private readonly masterKey: Buffer;
  private readonly masterSeed: Uint8Array;
  private readonly db: Database;

  constructor(db: Database, encryptionSecret: string, hdSeedSource: string) {
    this.db = db;
    this.masterKey = deriveMasterKey(encryptionSecret);

    // Determine if hdSeedSource is a mnemonic or hex seed
    if (hdSeedSource.includes(" ")) {
      this.masterSeed = seedFromMnemonic(hdSeedSource);
    } else {
      this.masterSeed = seedFromHex(hdSeedSource);
    }
  }

  /**
   * Create a new trading wallet for a user.
   * Derives the next available HD index and stores the encrypted private key.
   */
  async createWalletForUser(userId: string): Promise<{ address: `0x${string}`; walletId: string }> {
    // Get the next derivation index
    const existing = await this.db.select({ derivationIndex: tradingWallets.derivationIndex })
      .from(tradingWallets);

    const nextIndex = existing.length > 0
      ? Math.max(...existing.map((e) => e.derivationIndex)) + 1
      : 0;

    const wallet = deriveWallet(this.masterSeed, nextIndex);
    const encrypted = encryptPrivateKey(wallet.privateKey, this.masterKey);

    const walletId = crypto.randomUUID();
    await this.db.insert(tradingWallets).values({
      id: walletId,
      userId,
      address: wallet.address.toLowerCase(),
      derivationIndex: nextIndex,
      encryptedPrivateKey: encrypted,
    });

    return { address: wallet.address, walletId };
  }

  /**
   * Get the decrypted private key for a user's trading wallet.
   */
  async getPrivateKey(userId: string): Promise<`0x${string}` | null> {
    const [wallet] = await this.db.select()
      .from(tradingWallets)
      .where(eq(tradingWallets.userId, userId))
      .limit(1);

    if (!wallet) return null;

    const decrypted = decryptPrivateKey(wallet.encryptedPrivateKey, this.masterKey);
    return decrypted as `0x${string}`;
  }

  /**
   * Get the trading wallet address for a user.
   */
  async getWalletAddress(userId: string): Promise<string | null> {
    const [wallet] = await this.db.select({ address: tradingWallets.address })
      .from(tradingWallets)
      .where(eq(tradingWallets.userId, userId))
      .limit(1);

    return wallet?.address ?? null;
  }
}
