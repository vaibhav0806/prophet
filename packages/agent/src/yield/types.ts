import type { Position, ArbitOpportunity } from "../types.js";

export interface ScoredPosition {
  position: Position;
  score: number;
  annualizedYield: number;
  riskFactors: string[];
  estimatedResolutionMs: number;
}

export interface AllocationPlan {
  opportunity: ArbitOpportunity;
  recommendedSize: bigint;
  kellyFraction: number;
}

export interface RotationSuggestion {
  exitPositionId: number;
  enterOpportunity: ArbitOpportunity;
  currentYield: number;
  newYield: number;
  yieldImprovement: number;
  estimatedExitCost: bigint;
}

export interface YieldStatus {
  scoredPositions: ScoredPosition[];
  allocationPlan: AllocationPlan[];
  rotationSuggestions: RotationSuggestion[];
  totalDeployed: string;
  weightedAvgYield: number;
}
