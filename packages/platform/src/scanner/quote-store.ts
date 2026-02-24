import type { MarketQuote } from "@prophit/agent/src/types.js";

export class QuoteStore {
  private quotes: MarketQuote[] = [];
  private updatedAt = 0;

  update(quotes: MarketQuote[]): void {
    this.quotes = quotes;
    this.updatedAt = Date.now();
  }

  async getLatestQuotes(): Promise<MarketQuote[]> {
    return this.quotes;
  }

  getUpdatedAt(): number {
    return this.updatedAt;
  }

  getCount(): number {
    return this.quotes.length;
  }
}
