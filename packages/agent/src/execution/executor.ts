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

  async executeBest(opportunity: ArbitOpportunity): Promise<void> {
    // Split maxPositionSize evenly between A and B sides
    const amountPerSide = this.config.maxPositionSize / 2n;

    console.log(
      `[Executor] Executing arb: ${opportunity.protocolA} vs ${opportunity.protocolB}`,
    );
    console.log(
      `[Executor] Spread: ${opportunity.spreadBps} bps, buyYesOnA: ${opportunity.buyYesOnA}`,
    );
    console.log(`[Executor] Amount per side: ${amountPerSide}`);

    try {
      const positionId = await this.vaultClient.openPosition({
        adapterA: this.config.adapterAAddress,
        adapterB: this.config.adapterBAddress,
        marketIdA: this.config.marketId,
        marketIdB: this.config.marketId,
        buyYesOnA: opportunity.buyYesOnA,
        amountA: amountPerSide,
        amountB: amountPerSide,
        minSharesA: 0n, // No slippage protection for MVP
        minSharesB: 0n,
      });

      console.log(`[Executor] Position opened: #${positionId}`);
    } catch (err) {
      console.error("[Executor] Failed to execute trade:", err);
      throw err;
    }
  }
}
