export interface MarketQuote {
  marketId: `0x${string}`;
  protocol: string;
  yesPrice: bigint;
  noPrice: bigint;
  yesLiquidity: bigint;
  noLiquidity: bigint;
}

export interface ArbitOpportunity {
  marketId: `0x${string}`;
  protocolA: string;
  protocolB: string;
  buyYesOnA: boolean;
  yesPriceA: bigint;
  noPriceB: bigint;
  totalCost: bigint;
  guaranteedPayout: bigint; // 1e18 per share
  spreadBps: number;
  estProfit: bigint;
}

export interface Position {
  positionId: number;
  adapterA: `0x${string}`;
  adapterB: `0x${string}`;
  marketIdA: `0x${string}`;
  marketIdB: `0x${string}`;
  boughtYesOnA: boolean;
  sharesA: bigint;
  sharesB: bigint;
  costA: bigint;
  costB: bigint;
  openedAt: bigint;
  closed: boolean;
}

export interface AgentStatus {
  running: boolean;
  lastScan: number;
  tradesExecuted: number;
  uptime: number;
  config: {
    minSpreadBps: number;
    maxPositionSize: string;
    scanIntervalMs: number;
  };
}
