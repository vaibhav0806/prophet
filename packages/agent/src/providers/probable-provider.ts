import type { PublicClient } from "viem";
import { MarketProvider } from "./base.js";
import type { MarketQuote } from "../types.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";

// Probable: AMM-based zero-fee prediction market on BNB Chain (incubated by PancakeSwap).
// No public REST API — prices are read on-chain from CPMM pool reserves.
// Implied price: yesPrice = noReserve / (yesReserve + noReserve)
//
// To wire up in index.ts:
//   import { ProbableProvider } from "./providers/probable-provider.js";
//   const probableProvider = new ProbableProvider(
//     publicClient,
//     config.probableAdapterAddress!,
//     config.probableMarketIds!,
//     config.probablePoolMap!,
//   );
//   providers.push(probableProvider);

const getReservesAbi = [
  {
    type: "function",
    name: "getReserves",
    inputs: [],
    outputs: [
      { name: "yesRes", type: "uint256", internalType: "uint256" },
      { name: "noRes", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;

const getQuoteAbi = [
  {
    type: "function",
    name: "getQuote",
    inputs: [
      { name: "marketId", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct MarketQuote",
        components: [
          { name: "marketId", type: "bytes32", internalType: "bytes32" },
          { name: "yesPrice", type: "uint256", internalType: "uint256" },
          { name: "noPrice", type: "uint256", internalType: "uint256" },
          { name: "yesLiquidity", type: "uint256", internalType: "uint256" },
          { name: "noLiquidity", type: "uint256", internalType: "uint256" },
          { name: "resolved", type: "bool", internalType: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

export class ProbableProvider extends MarketProvider {
  private client: PublicClient;
  private marketIds: `0x${string}`[];
  // Maps our internal marketId to pool address
  private poolMap: Map<string, `0x${string}`>;

  constructor(
    client: PublicClient,
    adapterAddress: `0x${string}`,
    marketIds: `0x${string}`[],
    poolMap: Map<string, `0x${string}`>,
  ) {
    super("Probable", adapterAddress);
    this.client = client;
    this.marketIds = marketIds;
    this.poolMap = poolMap;
  }

  async fetchQuotes(): Promise<MarketQuote[]> {
    const quotes: MarketQuote[] = [];

    for (const marketId of this.marketIds) {
      try {
        const poolAddress = this.poolMap.get(marketId);

        if (poolAddress) {
          // Primary: read pool reserves directly for freshest data
          const quote = await this.fetchFromPool(marketId, poolAddress);
          if (quote) {
            quotes.push(quote);
            continue;
          }
        }

        // Fallback: read from adapter's getQuote (which also reads pool reserves)
        const quote = await this.fetchFromAdapter(marketId);
        if (quote) {
          quotes.push(quote);
        }
      } catch (err) {
        log.warn("Failed to fetch Probable quote", {
          marketId,
          error: String(err),
        });
      }
    }

    return quotes;
  }

  private async fetchFromPool(
    marketId: `0x${string}`,
    poolAddress: `0x${string}`,
  ): Promise<MarketQuote | null> {
    const [yesRes, noRes] = await withRetry(
      () =>
        this.client.readContract({
          address: poolAddress,
          abi: getReservesAbi,
          functionName: "getReserves",
        }),
      { label: `Probable pool reserves ${marketId}` },
    );

    const total = yesRes + noRes;
    if (total === 0n) return null;

    // CPMM implied price: price_yes = noReserve / (yesReserve + noReserve)
    const yesPrice = (noRes * 10n ** 18n) / total;
    const noPrice = (yesRes * 10n ** 18n) / total;

    return {
      marketId,
      protocol: this.name,
      yesPrice,
      noPrice,
      yesLiquidity: yesRes,
      noLiquidity: noRes,
    };
  }

  private async fetchFromAdapter(
    marketId: `0x${string}`,
  ): Promise<MarketQuote | null> {
    const result = await withRetry(
      () =>
        this.client.readContract({
          address: this.adapterAddress,
          abi: getQuoteAbi,
          functionName: "getQuote",
          args: [marketId],
        }),
      { label: `Probable adapter getQuote ${marketId}` },
    );

    // Skip resolved markets
    if (result.resolved) return null;

    // Skip markets with no price data
    if (result.yesPrice === 0n && result.noPrice === 0n) return null;

    return {
      marketId: result.marketId,
      protocol: this.name,
      yesPrice: result.yesPrice,
      noPrice: result.noPrice,
      yesLiquidity: result.yesLiquidity,
      noLiquidity: result.noLiquidity,
    };
  }
}
