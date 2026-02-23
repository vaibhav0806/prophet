import type { PublicClient } from "viem";
import type { ArbitOpportunity, Position, ClobPosition, ClobLeg, MarketMeta, ExecutionMode } from "../types.js";
import type { VaultClient } from "./vault-client.js";
import type { ClobClient, PlaceOrderParams, OrderStatus } from "../clob/types.js";
import type { Config } from "../config.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";

const isResolvedAbi = [
  {
    type: "function",
    name: "isResolved",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

interface ClobClients {
  probable?: ClobClient;
  predict?: ClobClient;
}

interface MarketMetaResolver {
  getMarketMeta(marketId: `0x${string}`): MarketMeta | undefined;
}

export class Executor {
  private vaultClient: VaultClient;
  private config: Config;
  private publicClient: PublicClient;
  private clobClients: ClobClients;
  private metaResolvers: Map<string, MarketMetaResolver>;

  constructor(
    vaultClient: VaultClient,
    config: Config,
    publicClient: PublicClient,
    clobClients?: ClobClients,
    metaResolvers?: Map<string, MarketMetaResolver>,
  ) {
    this.vaultClient = vaultClient;
    this.config = config;
    this.publicClient = publicClient;
    this.clobClients = clobClients ?? {};
    this.metaResolvers = metaResolvers ?? new Map();
  }

  async executeBest(opportunity: ArbitOpportunity, maxPositionSize: bigint): Promise<ClobPosition | void> {
    if (this.config.executionMode === "clob") {
      return this.executeClob(opportunity, maxPositionSize);
    }
    return this.executeVault(opportunity, maxPositionSize);
  }

  // ---------------------------------------------------------------------------
  // Vault mode (existing)
  // ---------------------------------------------------------------------------

  private async executeVault(opportunity: ArbitOpportunity, maxPositionSize: bigint): Promise<void> {
    // Split maxPositionSize evenly between A and B sides
    let amountPerSide = maxPositionSize / 2n;

    // Cap position size to available liquidity (use 90% to leave room for slippage)
    if (opportunity.liquidityA > 0n && opportunity.liquidityA < amountPerSide) {
      const capped = opportunity.liquidityA * 90n / 100n;
      if (capped === 0n) {
        log.info("Insufficient liquidity on protocol A", {
          available: opportunity.liquidityA.toString(),
          needed: amountPerSide.toString(),
        });
        return;
      }
      log.info("Capping position size to liquidity on A", {
        original: amountPerSide.toString(),
        capped: capped.toString(),
      });
      amountPerSide = capped;
    }
    if (opportunity.liquidityB > 0n && opportunity.liquidityB < amountPerSide) {
      const capped = opportunity.liquidityB * 90n / 100n;
      if (capped === 0n) {
        log.info("Insufficient liquidity on protocol B", {
          available: opportunity.liquidityB.toString(),
          needed: amountPerSide.toString(),
        });
        return;
      }
      log.info("Capping position size to liquidity on B", {
        original: amountPerSide.toString(),
        capped: capped.toString(),
      });
      amountPerSide = capped;
    }

    // Check vault balance before trading
    const vaultBalance = await this.vaultClient.getVaultBalance();
    const totalNeeded = amountPerSide * 2n;
    if (vaultBalance < totalNeeded) {
      log.info("Insufficient vault balance", { vaultBalance: vaultBalance.toString(), totalNeeded: totalNeeded.toString() });
      return;
    }

    // Estimate gas cost for profitability check
    try {
      const gasPrice = await withRetry(
        () => this.vaultClient.publicClient.getGasPrice(),
        { label: "getGasPrice" },
      );
      // openPosition typically uses ~400k gas
      const estimatedGasCost = gasPrice * 400_000n;

      // Convert gas cost (in native token wei) to approximate USDT value
      // gasToUsdtRate = native token price in 6-decimal USDT (e.g., $3000 ETH = 3000_000_000n)
      const gasCostUsdt = (estimatedGasCost * this.config.gasToUsdtRate) / BigInt(1e18);

      if (opportunity.estProfit <= gasCostUsdt) {
        log.info("Trade unprofitable after gas", { profit: opportunity.estProfit.toString(), gasCost: gasCostUsdt.toString() });
        return;
      }
    } catch (e) {
      log.warn("Gas estimation failed, proceeding anyway", { error: String(e) });
    }

    log.info("Executing arb (vault mode)", {
      protocolA: opportunity.protocolA,
      protocolB: opportunity.protocolB,
      spreadBps: opportunity.spreadBps,
      buyYesOnA: opportunity.buyYesOnA,
      amountPerSide: amountPerSide.toString(),
    });

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

      log.info("Position opened", { positionId: positionId.toString() });
    } catch (err) {
      log.error("Failed to execute trade", { error: String(err) });
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // CLOB mode (new)
  // ---------------------------------------------------------------------------

  private async executeClob(opportunity: ArbitOpportunity, maxPositionSize: bigint): Promise<ClobPosition | void> {
    const clientA = this.getClobClient(opportunity.protocolA);
    const clientB = this.getClobClient(opportunity.protocolB);

    if (!clientA || !clientB) {
      log.error("CLOB client not available for execution", {
        protocolA: opportunity.protocolA,
        protocolB: opportunity.protocolB,
        hasA: !!clientA,
        hasB: !!clientB,
      });
      return;
    }

    // Resolve token IDs via provider metadata
    const metaA = this.metaResolvers.get(opportunity.protocolA)?.getMarketMeta(opportunity.marketId);
    const metaB = this.metaResolvers.get(opportunity.protocolB)?.getMarketMeta(opportunity.marketId);

    if (!metaA || !metaB) {
      log.error("Cannot resolve market meta for CLOB execution", {
        marketId: opportunity.marketId,
        hasMetaA: !!metaA,
        hasMetaB: !!metaB,
      });
      return;
    }

    // Calculate size: cap to liquidity (90%)
    const SCALE = 1_000_000n;
    let sizeUsdt = Number(maxPositionSize / 2n) / 1_000_000; // Convert 6-dec to human

    const liqA = Number(opportunity.liquidityA) / 1_000_000;
    const liqB = Number(opportunity.liquidityB) / 1_000_000;

    if (liqA > 0 && liqA * 0.9 < sizeUsdt) sizeUsdt = liqA * 0.9;
    if (liqB > 0 && liqB * 0.9 < sizeUsdt) sizeUsdt = liqB * 0.9;

    if (sizeUsdt < 1) {
      log.info("CLOB: position size too small after liquidity cap", { sizeUsdt });
      return;
    }

    // Determine legs
    // buyYesOnA=true: Buy YES on A, Buy NO on B
    // buyYesOnA=false: Buy NO on A, Buy YES on B
    const priceA = Number(opportunity.yesPriceA) / 1e18;
    const priceB = Number(opportunity.noPriceB) / 1e18;

    const legAParams: PlaceOrderParams = {
      tokenId: opportunity.buyYesOnA ? metaA.yesTokenId : metaA.noTokenId,
      side: "BUY",
      price: priceA,
      size: sizeUsdt,
    };

    const legBParams: PlaceOrderParams = {
      tokenId: opportunity.buyYesOnA ? metaB.noTokenId : metaB.yesTokenId,
      side: "BUY",
      price: priceB,
      size: sizeUsdt,
    };

    log.info("Executing arb (CLOB mode)", {
      protocolA: opportunity.protocolA,
      protocolB: opportunity.protocolB,
      spreadBps: opportunity.spreadBps,
      sizeUsdt,
      legA: legAParams,
      legB: legBParams,
    });

    // Place both legs near-simultaneously
    const [resultA, resultB] = await Promise.all([
      clientA.placeOrder(legAParams),
      clientB.placeOrder(legBParams),
    ]);

    const legA: ClobLeg = {
      platform: opportunity.protocolA,
      orderId: resultA.orderId ?? "",
      tokenId: legAParams.tokenId,
      side: "BUY",
      price: priceA,
      size: sizeUsdt,
      filled: false,
      filledSize: 0,
    };

    const legB: ClobLeg = {
      platform: opportunity.protocolB,
      orderId: resultB.orderId ?? "",
      tokenId: legBParams.tokenId,
      side: "BUY",
      price: priceB,
      size: sizeUsdt,
      filled: false,
      filledSize: 0,
    };

    if (!resultA.success && !resultB.success) {
      log.error("Both CLOB legs failed", { errorA: resultA.error, errorB: resultB.error });
      return;
    }

    if (!resultA.success) {
      log.error("CLOB leg A failed, cancelling leg B", { error: resultA.error });
      if (resultB.orderId) await clientB.cancelOrder(resultB.orderId);
      return;
    }

    if (!resultB.success) {
      log.error("CLOB leg B failed, cancelling leg A", { error: resultB.error });
      if (resultA.orderId) await clientA.cancelOrder(resultA.orderId);
      return;
    }

    const position: ClobPosition = {
      id: `clob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      marketId: opportunity.marketId,
      status: "OPEN",
      legA,
      legB,
      totalCost: sizeUsdt * 2,
      expectedPayout: sizeUsdt * 2 * (1 + opportunity.spreadBps / 10000),
      spreadBps: opportunity.spreadBps,
      openedAt: Date.now(),
    };

    log.info("CLOB position opened", {
      id: position.id,
      orderIdA: resultA.orderId,
      orderIdB: resultB.orderId,
    });

    return this.pollForFills(position);
  }

  async pollForFills(position: ClobPosition): Promise<ClobPosition> {
    const clientA = this.getClobClient(position.legA.platform);
    const clientB = this.getClobClient(position.legB.platform);

    if (!clientA || !clientB) {
      log.warn("Cannot poll fills — missing CLOB client", {
        platformA: position.legA.platform,
        platformB: position.legB.platform,
      });
      return position;
    }

    const intervalMs = this.config.fillPollIntervalMs;
    const timeoutMs = this.config.fillPollTimeoutMs;
    const deadline = Date.now() + timeoutMs;

    log.info("Polling for fills", {
      positionId: position.id,
      orderIdA: position.legA.orderId,
      orderIdB: position.legB.orderId,
      intervalMs,
      timeoutMs,
    });

    const isFinal = (s: OrderStatus) =>
      s === "FILLED" || s === "CANCELLED" || s === "EXPIRED";

    while (Date.now() < deadline) {
      const [statusA, statusB] = await Promise.all([
        clientA.getOrderStatus(position.legA.orderId),
        clientB.getOrderStatus(position.legB.orderId),
      ]);

      position.legA.filledSize = statusA.filledSize;
      position.legB.filledSize = statusB.filledSize;
      position.legA.filled = statusA.status === "FILLED";
      position.legB.filled = statusB.status === "FILLED";

      log.info("Fill poll status", {
        positionId: position.id,
        statusA: statusA.status,
        statusB: statusB.status,
        filledA: statusA.filledSize,
        filledB: statusB.filledSize,
      });

      // Both filled
      if (statusA.status === "FILLED" && statusB.status === "FILLED") {
        position.status = "FILLED";
        log.info("Both legs filled", { positionId: position.id });
        return position;
      }

      // Both dead (cancelled/expired)
      if (isFinal(statusA.status) && isFinal(statusB.status) &&
          statusA.status !== "FILLED" && statusB.status !== "FILLED") {
        position.status = "EXPIRED";
        log.info("Both legs cancelled/expired", { positionId: position.id });
        return position;
      }

      // One filled, other dead — CRITICAL partial fill
      if (statusA.status === "FILLED" && isFinal(statusB.status) && statusB.status !== "FILLED") {
        position.status = "PARTIAL";
        log.error("CRITICAL: Leg A filled but leg B dead — naked exposure", {
          positionId: position.id,
          statusA: statusA.status,
          statusB: statusB.status,
        });
        return position;
      }
      if (statusB.status === "FILLED" && isFinal(statusA.status) && statusA.status !== "FILLED") {
        position.status = "PARTIAL";
        log.error("CRITICAL: Leg B filled but leg A dead — naked exposure", {
          positionId: position.id,
          statusA: statusA.status,
          statusB: statusB.status,
        });
        return position;
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    // Timeout — cancel unfilled legs
    log.warn("Fill poll timeout", { positionId: position.id });

    const [finalA, finalB] = await Promise.all([
      clientA.getOrderStatus(position.legA.orderId),
      clientB.getOrderStatus(position.legB.orderId),
    ]);

    const aFilled = finalA.status === "FILLED";
    const bFilled = finalB.status === "FILLED";

    if (!aFilled && !bFilled) {
      // Cancel both
      await Promise.all([
        clientA.cancelOrder(position.legA.orderId),
        clientB.cancelOrder(position.legB.orderId),
      ]);
      position.status = "EXPIRED";
      log.info("Timeout: cancelled both unfilled legs", { positionId: position.id });
      return position;
    }

    if (aFilled && !bFilled) {
      await clientB.cancelOrder(position.legB.orderId);
      position.legA.filled = true;
      position.legA.filledSize = finalA.filledSize;
      position.status = "PARTIAL";
      log.error("CRITICAL: Timeout — leg A filled, cancelled leg B — naked exposure", {
        positionId: position.id,
      });
      return position;
    }

    if (bFilled && !aFilled) {
      await clientA.cancelOrder(position.legA.orderId);
      position.legB.filled = true;
      position.legB.filledSize = finalB.filledSize;
      position.status = "PARTIAL";
      log.error("CRITICAL: Timeout — leg B filled, cancelled leg A — naked exposure", {
        positionId: position.id,
      });
      return position;
    }

    // Both filled at timeout check
    position.legA.filled = true;
    position.legB.filled = true;
    position.legA.filledSize = finalA.filledSize;
    position.legB.filledSize = finalB.filledSize;
    position.status = "FILLED";
    log.info("Both legs filled at timeout check", { positionId: position.id });
    return position;
  }

  private getClobClient(protocol: string): ClobClient | undefined {
    const name = protocol.toLowerCase();
    if (name === "probable") return this.clobClients.probable;
    if (name === "predict") return this.clobClients.predict;
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Close resolved (vault mode only)
  // ---------------------------------------------------------------------------

  async closeResolved(positions: Position[]): Promise<number> {
    let closed = 0;

    for (const pos of positions) {
      if (pos.closed) continue;

      try {
        // Check if either side's market is resolved
        const [resolvedA, resolvedB] = await Promise.all([
          this.publicClient.readContract({
            address: pos.adapterA,
            abi: isResolvedAbi,
            functionName: "isResolved",
            args: [pos.marketIdA],
          }),
          this.publicClient.readContract({
            address: pos.adapterB,
            abi: isResolvedAbi,
            functionName: "isResolved",
            args: [pos.marketIdB],
          }),
        ]);

        if (resolvedA && resolvedB) {
          log.info("Closing resolved position", { positionId: pos.positionId });
          const payout = await this.vaultClient.closePosition(pos.positionId, 0n);
          log.info("Position closed", {
            positionId: pos.positionId,
            payout: payout.toString(),
          });
          closed++;
        }
      } catch (err) {
        log.error("Failed to close position", {
          positionId: pos.positionId,
          error: String(err),
        });
      }
    }

    return closed;
  }
}
