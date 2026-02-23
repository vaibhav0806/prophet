import OpenAI from "openai";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";
import type { MarketQuote } from "../types.js";

export interface EmbeddedQuote {
  quote: MarketQuote;
  embedding: number[];
}

export class Embedder {
  private client: OpenAI;
  private model = "text-embedding-3-small";
  // In-memory cache: eventDescription -> embedding
  private cache = new Map<string, number[]>();

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Embed a batch of MarketQuotes that have eventDescription set.
   * Quotes without eventDescription are skipped.
   */
  async embedQuotes(quotes: MarketQuote[]): Promise<EmbeddedQuote[]> {
    const withDesc = quotes.filter((q) => q.eventDescription);
    if (withDesc.length === 0) return [];

    // Separate cached vs uncached
    const uncached: MarketQuote[] = [];
    const results: EmbeddedQuote[] = [];

    for (const q of withDesc) {
      const cached = this.cache.get(q.eventDescription!);
      if (cached) {
        results.push({ quote: q, embedding: cached });
      } else {
        uncached.push(q);
      }
    }

    if (uncached.length === 0) return results;

    // Batch embed uncached descriptions
    const descriptions = uncached.map((q) => q.eventDescription!);
    const embeddings = await this.batchEmbed(descriptions);

    for (let i = 0; i < uncached.length; i++) {
      const embedding = embeddings[i];
      this.cache.set(uncached[i].eventDescription!, embedding);
      results.push({ quote: uncached[i], embedding });
    }

    log.info("Embedded event descriptions", {
      total: withDesc.length,
      cached: withDesc.length - uncached.length,
      newlyEmbedded: uncached.length,
    });

    return results;
  }

  private async batchEmbed(texts: string[]): Promise<number[][]> {
    return withRetry(
      async () => {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: texts,
        });
        return response.data
          .sort((a, b) => a.index - b.index)
          .map((d) => d.embedding);
      },
      { label: "OpenAI embeddings", retries: 2, delayMs: 1000 },
    );
  }

  /** Expose for testing. */
  getCacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
