import OpenAI from "openai";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";
import type { ArbitOpportunity, MarketQuote, RiskAssessment } from "../types.js";

export class RiskAssessor {
  private client: OpenAI;
  private model = "gpt-4o-mini";

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Assess the risk of an arbitrage opportunity using LLM analysis.
   */
  async assess(
    opportunity: ArbitOpportunity,
    quotes: MarketQuote[],
  ): Promise<RiskAssessment> {
    const prompt = this.buildPrompt(opportunity, quotes);

    const result = await withRetry(
      async () => {
        const response = await this.client.chat.completions.create({
          model: this.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are a risk analyst for prediction market arbitrage. " +
                "Assess the risks of executing an arbitrage trade across two protocols. " +
                "Respond with JSON only.",
            },
            { role: "user", content: prompt },
          ],
        });

        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error("Empty LLM response");
        return JSON.parse(content) as RiskAssessment;
      },
      { label: "LLM risk assessment", retries: 2, delayMs: 1000 },
    );

    // Clamp values to valid ranges
    result.riskScore = Math.max(0, Math.min(1, result.riskScore));
    result.recommendedSizeMultiplier = Math.max(0, Math.min(1, result.recommendedSizeMultiplier));

    log.info("LLM risk assessment", {
      protocolA: opportunity.protocolA,
      protocolB: opportunity.protocolB,
      spreadBps: opportunity.spreadBps,
      riskScore: result.riskScore,
      recommendedSizeMultiplier: result.recommendedSizeMultiplier,
      concerns: result.concerns,
    });

    return result;
  }

  private buildPrompt(
    opportunity: ArbitOpportunity,
    quotes: MarketQuote[],
  ): string {
    const quoteA = quotes.find((q) => q.protocol === opportunity.protocolA);
    const quoteB = quotes.find((q) => q.protocol === opportunity.protocolB);

    return [
      "Assess the risk of this prediction market arbitrage opportunity:",
      "",
      `Protocol A: ${opportunity.protocolA}`,
      `  Description: ${quoteA?.eventDescription ?? "N/A"}`,
      `  Category: ${quoteA?.category ?? "N/A"}`,
      `  Expires: ${quoteA?.expiresAt ? new Date(quoteA.expiresAt * 1000).toISOString() : "N/A"}`,
      `  Yes price: ${opportunity.yesPriceA.toString()}`,
      `  Liquidity (yes): ${quoteA?.yesLiquidity.toString() ?? "N/A"}`,
      "",
      `Protocol B: ${opportunity.protocolB}`,
      `  Description: ${quoteB?.eventDescription ?? "N/A"}`,
      `  Category: ${quoteB?.category ?? "N/A"}`,
      `  Expires: ${quoteB?.expiresAt ? new Date(quoteB.expiresAt * 1000).toISOString() : "N/A"}`,
      `  No price: ${opportunity.noPriceB.toString()}`,
      `  Liquidity (no): ${quoteB?.noLiquidity.toString() ?? "N/A"}`,
      "",
      `Spread: ${opportunity.spreadBps} bps`,
      `Estimated profit: ${opportunity.estProfit.toString()}`,
      "",
      "Consider these risk factors:",
      "1. Oracle divergence risk — different oracles may resolve the same event differently",
      "2. Resolution timing risk — markets may resolve at different times",
      "3. Liquidity risk — ability to enter/exit positions",
      "4. Smart contract risk — protocol-specific risks",
      "",
      "Respond with JSON:",
      '{ "riskScore": number (0-1, higher = riskier), "recommendedSizeMultiplier": number (0-1, fraction of max position), "concerns": string[] }',
    ].join("\n");
  }
}
