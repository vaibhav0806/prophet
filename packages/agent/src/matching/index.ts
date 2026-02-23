import { Embedder } from "./embedder.js";
import { clusterByEvent } from "./cluster.js";
import { Verifier } from "./verifier.js";
import { RiskAssessor } from "./risk-assessor.js";
import { log } from "../logger.js";
import type { MarketQuote, ArbitOpportunity, RiskAssessment } from "../types.js";

export { Embedder } from "./embedder.js";
export { clusterByEvent, cosineSimilarity } from "./cluster.js";
export { Verifier } from "./verifier.js";
export { RiskAssessor } from "./risk-assessor.js";

export interface MatchedCluster {
  /** Quotes from different protocols that refer to the same event. */
  quotes: MarketQuote[];
  /** Cosine similarity score from embedding comparison. */
  similarity: number;
  /** LLM verification confidence. */
  confidence: number;
}

export class MatchingPipeline {
  private embedder: Embedder;
  private verifier: Verifier;
  private riskAssessor: RiskAssessor;
  private similarityThreshold: number;
  private confidenceThreshold: number;

  constructor(
    apiKey: string,
    similarityThreshold = 0.85,
    confidenceThreshold = 0.90,
  ) {
    this.embedder = new Embedder(apiKey);
    this.verifier = new Verifier(apiKey);
    this.riskAssessor = new RiskAssessor(apiKey);
    this.similarityThreshold = similarityThreshold;
    this.confidenceThreshold = confidenceThreshold;
  }

  /**
   * Run the full matching pipeline:
   * 1. Embed event descriptions
   * 2. Cluster by cosine similarity
   * 3. Verify each cluster with LLM
   *
   * Returns verified clusters of semantically matched quotes.
   */
  async matchQuotes(quotes: MarketQuote[]): Promise<MatchedCluster[]> {
    // Only process quotes that have event descriptions
    const withDescriptions = quotes.filter((q) => q.eventDescription);
    if (withDescriptions.length < 2) {
      log.info("Not enough described quotes for semantic matching", {
        count: withDescriptions.length,
      });
      return [];
    }

    // Step 1: Embed
    const embedded = await this.embedder.embedQuotes(withDescriptions);
    if (embedded.length < 2) return [];

    // Step 2: Cluster
    const candidates = clusterByEvent(embedded, this.similarityThreshold);
    if (candidates.length === 0) {
      log.info("No candidate clusters above similarity threshold", {
        threshold: this.similarityThreshold,
      });
      return [];
    }

    // Step 3: Verify each cluster with LLM
    const verified: MatchedCluster[] = [];

    for (const cluster of candidates) {
      // Verify all cross-protocol pairs in the cluster
      // For simplicity, verify the first pair (most common case is 2 quotes)
      const quoteA = cluster.quotes[0];
      const quoteB = cluster.quotes.find(
        (q) => q.protocol !== quoteA.protocol,
      );
      if (!quoteB) continue;

      const verification = await this.verifier.verify(quoteA, quoteB);

      if (verification.match && verification.confidence >= this.confidenceThreshold) {
        verified.push({
          quotes: cluster.quotes,
          similarity: cluster.similarity,
          confidence: verification.confidence,
        });
        log.info("Cluster verified as matching", {
          protocols: cluster.quotes.map((q) => q.protocol),
          similarity: cluster.similarity.toFixed(4),
          confidence: verification.confidence,
        });
      } else {
        log.info("Cluster rejected by LLM verification", {
          protocols: cluster.quotes.map((q) => q.protocol),
          match: verification.match,
          confidence: verification.confidence,
          reasoning: verification.reasoning,
        });
      }
    }

    return verified;
  }

  /**
   * Assess risk for an arbitrage opportunity.
   */
  async assessRisk(
    opportunity: ArbitOpportunity,
    quotes: MarketQuote[],
  ): Promise<RiskAssessment> {
    return this.riskAssessor.assess(opportunity, quotes);
  }
}
