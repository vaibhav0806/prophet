import type { ArbitOpportunity } from "../types.js";
import type { ScoredPosition, RotationSuggestion } from "./types.js";

const ONE = 10n ** 18n;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Default estimated resolution: 30 days */
const DEFAULT_RESOLUTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Check if existing positions should be exited in favor of better opportunities.
 *
 * Only suggests rotation if: new_yield - old_yield > minImprovementBps (default 200 bps).
 * Returns suggestions only, does not auto-execute.
 */
export function checkRotations(
  scoredPositions: ScoredPosition[],
  opportunities: ArbitOpportunity[],
  gasCostEstimate: bigint,
  minImprovementBps: number = 200,
): RotationSuggestion[] {
  if (scoredPositions.length === 0 || opportunities.length === 0) return [];

  // Compute annualized yield for each opportunity
  const oppYields: { opp: ArbitOpportunity; annualizedYield: number }[] = [];
  for (const opp of opportunities) {
    if (opp.totalCost === 0n || opp.totalCost >= ONE) continue;

    const spreadReturn = Number(ONE - opp.totalCost) / Number(ONE);
    const timeYears = DEFAULT_RESOLUTION_MS / MS_PER_YEAR;
    const annualizedYield = spreadReturn / timeYears;
    oppYields.push({ opp, annualizedYield });
  }

  if (oppYields.length === 0) return [];

  // Sort opportunities by yield descending
  oppYields.sort((a, b) => b.annualizedYield - a.annualizedYield);

  const suggestions: RotationSuggestion[] = [];

  for (const scored of scoredPositions) {
    const currentYield = scored.annualizedYield;

    // Find best opportunity that improves yield by at least minImprovementBps
    for (const { opp, annualizedYield: newYield } of oppYields) {
      // Yield improvement in bps: (newYield - currentYield) * 10000
      const improvementBps = (newYield - currentYield) * 10000;

      if (improvementBps < minImprovementBps) continue;

      // Estimate exit cost: gas for closing + gas for reopening
      const estimatedExitCost = gasCostEstimate * 2n;

      // Check that the improvement justifies exit costs
      const totalCost = scored.position.costA + scored.position.costB;
      if (totalCost === 0n) continue;

      // Exit cost as fraction of position
      const exitCostFraction = Number(estimatedExitCost) / Number(totalCost);
      // Net improvement after exit cost (annualized)
      const netImprovement = (newYield - currentYield) - exitCostFraction;

      if (netImprovement <= 0) continue;

      suggestions.push({
        exitPositionId: scored.position.positionId,
        enterOpportunity: opp,
        currentYield,
        newYield,
        yieldImprovement: improvementBps / 10000,
        estimatedExitCost,
      });

      // Only suggest the best rotation per position
      break;
    }
  }

  // Sort by yield improvement descending
  suggestions.sort((a, b) => b.yieldImprovement - a.yieldImprovement);

  return suggestions;
}
