import type { ArbitOpportunity } from "../types.js";
import type { AllocationPlan } from "./types.js";

const ONE = 10n ** 18n;
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Default estimated resolution: 30 days */
const DEFAULT_RESOLUTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Allocate capital across opportunities using half-Kelly criterion.
 *
 * kellyFraction = (p * b - q) / b
 * where b = (1/price - 1), q = 1 - p, p = implied probability of payout
 * size = max(0, kellyFraction / 2) * availableCapital
 *
 * Opportunities are ranked by risk-adjusted annualized yield.
 * Respects maxPositionSize and total exposure (availableCapital).
 */
export function allocateCapital(
  availableCapital: bigint,
  opportunities: ArbitOpportunity[],
  maxPositionSize: bigint,
): AllocationPlan[] {
  if (availableCapital <= 0n || opportunities.length === 0) return [];

  const scored: { opp: ArbitOpportunity; annualizedYield: number; kellyFraction: number }[] = [];

  for (const opp of opportunities) {
    if (opp.totalCost === 0n || opp.totalCost >= ONE) continue;

    // Implied probability of profit: the spread guarantees payout, so p ~ 1
    // but we use the spread as the edge. b = payout/cost - 1
    const b = Number(ONE - opp.totalCost) / Number(opp.totalCost);
    if (b <= 0) continue;

    // For arb positions, p is effectively 1 (guaranteed payout),
    // but we discount slightly based on execution risk
    const p = 0.95;
    const q = 1 - p;

    // Kelly: (p * b - q) / b
    const kellyFraction = (p * b - q) / b;
    if (kellyFraction <= 0) continue;

    // Annualized yield: spread / timeToResolution (in years)
    const spreadReturn = Number(ONE - opp.totalCost) / Number(ONE);
    const timeYears = DEFAULT_RESOLUTION_MS / MS_PER_YEAR;
    const annualizedYield = spreadReturn / timeYears;

    scored.push({ opp, annualizedYield, kellyFraction });
  }

  // Rank by annualized yield descending
  scored.sort((a, b) => b.annualizedYield - a.annualizedYield);

  const plans: AllocationPlan[] = [];
  let remaining = availableCapital;

  for (const { opp, kellyFraction, annualizedYield: _ } of scored) {
    if (remaining <= 0n) break;

    // Half-Kelly sizing
    const halfKelly = Math.max(0, kellyFraction / 2);
    let size = BigInt(Math.floor(halfKelly * Number(availableCapital)));

    // Clamp to max position size
    if (size > maxPositionSize) {
      size = maxPositionSize;
    }

    // Clamp to remaining capital
    if (size > remaining) {
      size = remaining;
    }

    if (size <= 0n) continue;

    remaining -= size;
    plans.push({
      opportunity: opp,
      recommendedSize: size,
      kellyFraction,
    });
  }

  return plans;
}
