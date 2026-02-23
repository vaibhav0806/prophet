import type { MarketQuote } from "../types.js";

export abstract class MarketProvider {
  readonly name: string;
  readonly adapterAddress: `0x${string}`;

  constructor(name: string, adapterAddress: `0x${string}`) {
    this.name = name;
    this.adapterAddress = adapterAddress;
  }

  abstract fetchQuotes(): Promise<MarketQuote[]>;
}
