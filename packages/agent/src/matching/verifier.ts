import OpenAI from "openai";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";
import type { MatchVerification, MarketQuote } from "../types.js";

export class Verifier {
  private client: OpenAI;
  private model = "gpt-4o-mini";

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /**
   * Verify whether a pair of market quotes refer to the exact same event
   * with the same resolution criteria.
   */
  async verify(quoteA: MarketQuote, quoteB: MarketQuote): Promise<MatchVerification> {
    const prompt = this.buildPrompt(quoteA, quoteB);

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
                "You are an expert at analyzing prediction market events. " +
                "You compare two market descriptions and determine if they refer to the EXACT same real-world event " +
                "with the SAME resolution criteria. Respond with JSON only.",
            },
            { role: "user", content: prompt },
          ],
        });

        const content = response.choices[0]?.message?.content;
        if (!content) throw new Error("Empty LLM response");
        return JSON.parse(content) as MatchVerification;
      },
      { label: "LLM match verification", retries: 2, delayMs: 1000 },
    );

    log.info("LLM match verification", {
      protocolA: quoteA.protocol,
      protocolB: quoteB.protocol,
      descriptionA: quoteA.eventDescription,
      descriptionB: quoteB.eventDescription,
      match: result.match,
      confidence: result.confidence,
      reasoning: result.reasoning,
    });

    return result;
  }

  private buildPrompt(quoteA: MarketQuote, quoteB: MarketQuote): string {
    return [
      "Are these two prediction markets about the EXACT same event with the SAME resolution criteria?",
      "",
      `Market A (${quoteA.protocol}):`,
      `  Description: ${quoteA.eventDescription ?? "N/A"}`,
      `  Category: ${quoteA.category ?? "N/A"}`,
      `  Expires: ${quoteA.expiresAt ? new Date(quoteA.expiresAt * 1000).toISOString() : "N/A"}`,
      "",
      `Market B (${quoteB.protocol}):`,
      `  Description: ${quoteB.eventDescription ?? "N/A"}`,
      `  Category: ${quoteB.category ?? "N/A"}`,
      `  Expires: ${quoteB.expiresAt ? new Date(quoteB.expiresAt * 1000).toISOString() : "N/A"}`,
      "",
      "Consider:",
      "- Do they refer to the exact same outcome?",
      "- Are the resolution dates compatible?",
      "- Could different oracles resolve them differently?",
      "",
      "Respond with JSON: { \"match\": boolean, \"confidence\": number (0-1), \"reasoning\": string }",
    ].join("\n");
  }
}
