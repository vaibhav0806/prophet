import type { Position } from "../types.js";
import type { ScoredPosition } from "./types.js";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Default estimated resolution time: 30 days in ms */
const DEFAULT_RESOLUTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Score open positions by risk-adjusted return.
 *
 * score = expected_return / time_to_resolution * liquidity_factor * (1 - oracle_risk_discount)
 */
export function scorePositions(
  positions: Position[],
  nowMs: number = Date.now(),
): ScoredPosition[] {
  const results: ScoredPosition[] = [];

  for (const pos of positions) {
    if (pos.closed) continue;

    const riskFactors: string[] = [];

    // Expected return: spread captured (cost basis vs expected $1.00 payout per share)
    const totalCost = pos.costA + pos.costB;
    if (totalCost === 0n) continue;

    // Each share pays 1 USDT (1e6) on resolution. Min shares determines guaranteed payout.
    const minShares = pos.sharesA < pos.sharesB ? pos.sharesA : pos.sharesB;
    // Payout in USDT (6 decimals): shares are in 1e18, cost is in 1e6
    // payout = minShares * 1e6 / 1e18 = minShares / 1e12
    const payoutUsdt = minShares / 10n ** 12n;

    if (payoutUsdt <= totalCost) {
      riskFactors.push("negative_expected_return");
    }

    const expectedReturn =
      payoutUsdt > totalCost
        ? Number(payoutUsdt - totalCost) / Number(totalCost)
        : 0;

    // Time to resolution estimate
    const openedAtMs = Number(pos.openedAt) * 1000;
    const elapsed = nowMs - openedAtMs;
    // Use expiry if available, otherwise default 30 days from open
    const estimatedResolutionMs = Math.max(DEFAULT_RESOLUTION_MS - elapsed, 1);

    if (estimatedResolutionMs < 24 * 60 * 60 * 1000) {
      riskFactors.push("near_resolution");
    }

    // Liquidity factor: based on share imbalance (balanced = better exit liquidity)
    const sharesMax = pos.sharesA > pos.sharesB ? pos.sharesA : pos.sharesB;
    const liquidityFactor =
      sharesMax > 0n ? Number(minShares) / Number(sharesMax) : 0;

    if (liquidityFactor < 0.8) {
      riskFactors.push("imbalanced_shares");
    }

    // Oracle risk discount: penalty for cross-oracle (different adapters)
    const crossOracle = pos.adapterA !== pos.adapterB;
    const oracleRiskDiscount = crossOracle ? 0.05 : 0;
    if (crossOracle) {
      riskFactors.push("cross_oracle");
    }

    // Annualized yield
    const timeToResolutionYears = estimatedResolutionMs / MS_PER_YEAR;
    const annualizedYield =
      timeToResolutionYears > 0 ? expectedReturn / timeToResolutionYears : 0;

    // Score = expected_return / time_to_resolution * liquidity_factor * (1 - oracle_risk_discount)
    const score =
      (expectedReturn / (estimatedResolutionMs / MS_PER_YEAR)) *
      liquidityFactor *
      (1 - oracleRiskDiscount);

    results.push({
      position: pos,
      score,
      annualizedYield,
      riskFactors,
      estimatedResolutionMs,
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}
