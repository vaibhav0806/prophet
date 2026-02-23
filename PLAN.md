# Prophit: AI Arbitrage Agent for Prediction Markets on BNB Chain

## One-liner

Autonomous AI agent that continuously scans prediction markets on BNB Chain (Opinion, Predict.fun, Probable, XO Market, Bento) for price discrepancies on the same or correlated events, executes delta-neutral arbitrage trades to capture risk-free profit, and rotates yield across markets based on risk-adjusted returns -- all from a single dashboard.

## Problem Statement

Prediction markets on BNB Chain are booming but structurally fragmented:

1. **Liquidity is fragmented across 5+ niche markets.** Opinion (CLOB-based, $20B cumulative volume), Predict.fun ($200M+ in first 3 weeks), Probable (AMM-based, zero-fee, PancakeSwap-incubated), XO Market (bonding curve, Celestia DA), and Bento (social/UGC markets) all operate as isolated silos. The same event -- "Will BTC hit $150K by June?" -- can be priced at 62% on Opinion, 57% on Predict.fun, and 65% on Probable. Nobody captures the spread.

2. **No cross-market price discovery.** Each market uses different architectures (CLOB vs. AMM vs. bonding curve), different collateral standards (USDT vs. multi-token), and different oracle systems (Opinion AI, UMA Optimistic Oracle, Chainlink, custom AI oracles). There is no unified view of odds across markets, and no way to act on discrepancies programmatically.

3. **Manual arbitrage is impractical.** On Polymarket/Kalshi alone, researchers documented **$40M in arbitrage profits** extracted between April 2024--April 2025 (top 10 arbitrageurs captured $8.18M). On BNB Chain, this opportunity is largely untapped because: (a) protocols are newer and less indexed, (b) market architectures differ making normalization hard, (c) no existing tooling bridges them.

4. **Capital sits idle during event resolution.** Prediction market positions lock capital until resolution (often weeks/months). Predict.fun pioneered DeFi yield on locked collateral, but there is no cross-market yield optimization -- capital doesn't flow to the highest risk-adjusted opportunity.

**Market Context:**
- Prediction Markets narrative momentum: rising, with BNB Chain as the fastest-growing ecosystem (5 protocols launched in 6 months)
- Known pain points: "Liquidity is fragmented across too many niche markets", "Market resolution is slow and often disputed"
- Originality: 90/100, Buildability: 88/100
- BSC: 0.75s blocks, ~$0.01 gas -- ideal for high-frequency arbitrage execution
- Cross-platform arbitrage on Polymarket alone generated $40M+ in documented profit -- BNB Chain markets are less efficient, meaning larger spreads

## Solution Overview

Prophit is an autonomous AI-powered arbitrage system that:

1. **Normalizes odds** across all 5 BNB Chain prediction markets into a unified probability format
2. **Uses LLM reasoning** to match semantically equivalent events across platforms (e.g., "Trump wins 2028" on Opinion = "Republican victory 2028" on Probable)
3. **Detects arbitrage** when the same event is mispriced across markets (YES on Market A + NO on Market B < $1.00 = guaranteed profit)
4. **Executes delta-neutral trades** atomically -- buying underpriced and selling overpriced outcomes simultaneously
5. **Rotates yield** by moving capital to markets with the best risk-adjusted returns
6. **Enforces safety** through on-chain spending limits, circuit breakers, and slippage protection

```
                        +-----------------------+
                        |    Prophit Core     |
                        |  (AI Reasoning Engine) |
                        +----------+------------+
                                   |
                    +--------------+--------------+
                    |                             |
          +---------v----------+     +------------v-----------+
          |  Market Normalizer |     |   Opportunity Scorer   |
          |  (Odds Unifier)    |     | (Arbitrage + Yield)    |
          +---------+----------+     +------------+-----------+
                    |                             |
     +--------------+--------------+              |
     |       |       |      |      |              |
+----v-+ +---v--+ +-v---+ +v---+ +v----+   +-----v------+
|Opinion| |Predict| |Prob.| |XO | |Bento|   | Execution  |
| CLOB  | | CLOB  | |AMM  | |Bond| |UGC |   |  Engine    |
|Adapter| |Adapter| |Adapt| |Adpt| |Adpt|   +-----+------+
+---+---+ +---+---+ +-+---+ +-+--+ +-+---+        |
    |         |        |       |      |       +----v-----+
    +----+----+---+----+---+---+------+       | BSC/opBNB|
         |        |        |                  | Contracts|
    +----v--------v--------v----+             +----------+
    |   BNB Chain (BSC / opBNB) |
    +---------------------------+
```

## Technical Architecture

### Smart Contracts (Solidity 0.8.24+)

**Contract 1: `ProphitVault.sol`** -- Capital Pool & Trade Execution

Holds user capital and executes arbitrage trades across prediction market contracts. Tracks P&L, enforces limits.

```solidity
contract ProphitVault is Ownable, ReentrancyGuard, Pausable {
    IERC20 public immutable usdt;

    struct ProphitPosition {
        bytes32 marketIdA;          // Market A identifier
        bytes32 marketIdB;          // Market B identifier
        address protocolA;          // Protocol A exchange contract
        address protocolB;          // Protocol B exchange contract
        uint256 tokenIdA;           // CTF token ID on protocol A (YES)
        uint256 tokenIdB;           // CTF token ID on protocol B (NO)
        uint256 costA;              // USDT spent on leg A
        uint256 costB;              // USDT spent on leg B
        uint256 sharesA;            // Outcome shares held on A
        uint256 sharesB;            // Outcome shares held on B
        uint256 openedAt;           // Block timestamp
        PositionStatus status;
    }

    enum PositionStatus { Open, PartiallyResolved, Closed, Liquidated }

    struct AgentConfig {
        uint256 maxPositionSize;    // Max USDT per single arbit position
        uint256 maxTotalExposure;   // Max aggregate USDT across all positions
        uint256 minSpread;          // Min spread (bps) to open position (e.g., 300 = 3%)
        uint256 maxSlippage;        // Max slippage tolerance (bps)
        uint256 maxDailyTrades;     // Circuit breaker: max trades per 24h
        uint256 maxDailyLoss;       // Circuit breaker: max loss in USDT per 24h
        uint256 cooldownSeconds;    // Min seconds between trades
        bool active;
    }

    mapping(uint256 => ProphitPosition) public positions;
    uint256 public positionCount;
    AgentConfig public agentConfig;
    address public agentAddress;

    // Daily tracking
    uint256 public dailyTradeCount;
    uint256 public dailyLossAccum;
    uint256 public lastResetTimestamp;

    event ProphitOpened(
        uint256 indexed positionId,
        address protocolA,
        address protocolB,
        uint256 costA,
        uint256 costB,
        uint256 expectedProfit
    );
    event ProphitClosed(uint256 indexed positionId, uint256 pnl, bool profitable);
    event CircuitBreakerTriggered(string reason, uint256 value, uint256 limit);
    event YieldRotation(address fromProtocol, address toProtocol, uint256 amount);

    modifier onlyAgent() {
        require(msg.sender == agentAddress, "NOT_AGENT");
        _;
    }

    modifier checkCircuitBreakers() {
        _resetDailyCountersIfNeeded();
        require(dailyTradeCount < agentConfig.maxDailyTrades, "DAILY_TRADE_LIMIT");
        require(dailyLossAccum < agentConfig.maxDailyLoss, "DAILY_LOSS_LIMIT");
        _;
    }

    function openProphitPosition(
        address protocolA,
        address protocolB,
        bytes calldata tradeDataA,   // Encoded buy call for leg A
        bytes calldata tradeDataB,   // Encoded buy call for leg B
        uint256 maxCostA,
        uint256 maxCostB
    ) external onlyAgent checkCircuitBreakers whenNotPaused nonReentrant {
        require(maxCostA + maxCostB <= agentConfig.maxPositionSize, "POSITION_TOO_LARGE");
        // Execute leg A
        usdt.approve(protocolA, maxCostA);
        (bool successA,) = protocolA.call(tradeDataA);
        require(successA, "LEG_A_FAILED");
        // Execute leg B
        usdt.approve(protocolB, maxCostB);
        (bool successB,) = protocolB.call(tradeDataB);
        require(successB, "LEG_B_FAILED");
        // Record position...
        dailyTradeCount++;
    }

    function closePosition(uint256 positionId) external onlyAgent nonReentrant {
        // Redeem resolved conditional tokens → USDT
        // Calculate P&L, update dailyLossAccum if loss
        // Emit ProphitClosed
    }
}
```

**Contract 2: `ProtocolAdapter.sol`** -- Unified Interface for Different Market Types

Abstract adapter pattern that normalizes interactions across CLOB, AMM, and bonding curve markets.

```solidity
interface IProtocolAdapter {
    /// @notice Get the current YES/NO prices for a market
    function getQuote(bytes32 marketId) external view returns (
        uint256 yesPrice,     // Price in USDT (18 decimals), e.g., 0.60e18 = 60%
        uint256 noPrice,      // Price in USDT (18 decimals)
        uint256 yesLiquidity, // Available depth at this price
        uint256 noLiquidity
    );

    /// @notice Buy outcome tokens
    function buyOutcome(
        bytes32 marketId,
        bool isYes,
        uint256 usdtAmount,
        uint256 minShares
    ) external returns (uint256 sharesReceived);

    /// @notice Sell outcome tokens
    function sellOutcome(
        bytes32 marketId,
        bool isYes,
        uint256 shares,
        uint256 minUsdt
    ) external returns (uint256 usdtReceived);

    /// @notice Redeem resolved outcome tokens for collateral
    function redeem(bytes32 marketId) external returns (uint256 usdtReceived);

    /// @notice Check if a market has resolved
    function isResolved(bytes32 marketId) external view returns (bool);
}
```

**Contract 3: `OpinionAdapter.sol`** -- Opinion CLOB Integration

Wraps Opinion's on-chain CLOB and Conditional Tokens Framework (CTF).

```solidity
contract OpinionAdapter is IProtocolAdapter {
    // Opinion uses Gnosis CTF on BSC
    IConditionalTokens public immutable ctf;  // 0xAD1a38cEc043e70E83a3eC30443dB285ED10D774
    address public immutable opinionExchange;
    IERC20 public immutable usdt;

    function buyOutcome(
        bytes32 marketId,
        bool isYes,
        uint256 usdtAmount,
        uint256 minShares
    ) external override returns (uint256 sharesReceived) {
        // 1. Approve USDT to Opinion exchange
        // 2. Place market order via Opinion CLOB
        // 3. Receive ERC1155 conditional tokens
        // 4. Return shares received
    }

    function redeem(bytes32 marketId) external override returns (uint256 usdtReceived) {
        // After resolution: ctf.redeemPositions(collateral, parentCollectionId, conditionId, indexSets)
    }
}
```

**Contract 4: `ProbableAdapter.sol`** -- Probable AMM Integration

Wraps Probable's AMM-based zero-fee market. Uses UMA Optimistic Oracle for resolution.

```solidity
contract ProbableAdapter is IProtocolAdapter {
    address public immutable probableRouter;
    IUMAOracle public immutable umaOracle;
    IERC20 public immutable usdt;

    function getQuote(bytes32 marketId) external view override returns (
        uint256 yesPrice, uint256 noPrice,
        uint256 yesLiquidity, uint256 noLiquidity
    ) {
        // Query AMM reserves to derive implied probability
        // price_yes = reserve_no / (reserve_yes + reserve_no)
        // Liquidity = depth before X% price impact
    }

    function buyOutcome(
        bytes32 marketId,
        bool isYes,
        uint256 usdtAmount,
        uint256 minShares
    ) external override returns (uint256 sharesReceived) {
        // 1. Probable auto-converts any token to USDT (zero fee)
        // 2. Swap via AMM pool
        // 3. Return outcome tokens
    }
}
```

### Frontend (Dashboard)

**Tech Stack:** Next.js 14, TypeScript, Tailwind + shadcn/ui, wagmi v2 + viem, TanStack Query, Recharts, Lightweight Charts (TradingView)

**Key Screens:**

| Screen | Purpose |
|--------|---------|
| **Arbitrage Scanner** | Live cross-market spread heatmap, sorted by profit potential. Shows: event, Market A price, Market B price, spread %, estimated profit, liquidity depth |
| **Active Positions** | Open arbit positions with leg details, entry prices, current P&L, time held, resolution countdown |
| **Agent Control Panel** | Start/stop agent, configure risk params (max position size, min spread, daily limits), view agent reasoning log |
| **Market Unifier** | Unified view of all events across 5 protocols, matched by AI similarity, with normalized odds comparison |
| **Yield Dashboard** | Capital allocation across protocols, APY comparison, yield rotation history, total returns |
| **Audit Trail** | Every agent trade with decoded calldata, BscScan links, P&L attribution, gas costs |

### AI Agent Runtime

**Tech Stack:** Node.js 20/TypeScript, OpenAI GPT-4o-mini, viem, Sentence Transformers (e5-large-v2), ChromaDB

```typescript
interface MarketQuote {
  protocol: "opinion" | "predict" | "probable" | "xo" | "bento";
  marketId: string;
  eventDescription: string;
  yesPrice: number;      // 0-1 (probability)
  noPrice: number;       // 0-1
  yesLiquidity: number;  // USDT depth
  noLiquidity: number;
  expiresAt: number;     // unix timestamp
  embedding?: number[];  // semantic vector for matching
}

interface ArbitOpportunity {
  eventCluster: string;            // Normalized event description
  marketA: MarketQuote;            // Underpriced leg
  marketB: MarketQuote;            // Overpriced leg
  spread: number;                  // e.g., 0.08 = 8% spread
  expectedProfit: number;          // USDT after fees + gas
  confidence: number;              // AI confidence that events match (0-1)
  maxPositionSize: number;         // Limited by min liquidity across legs
  riskScore: number;               // 0-1 (oracle risk, resolution risk, etc.)
}

async function agentLoop(config: AgentConfig) {
  const adapters = initProtocolAdapters(config);
  const vectorDb = await initChromaDb();

  while (config.active) {
    // 1. Fetch quotes from all 5 protocols
    const allQuotes = await Promise.allSettled(
      adapters.map(a => a.fetchAllMarkets())
    );
    const quotes = allQuotes
      .filter(r => r.status === "fulfilled")
      .flatMap(r => r.value);

    // 2. Embed event descriptions for semantic matching
    const embedded = await embedMarketDescriptions(quotes);

    // 3. Cluster similar events across protocols
    const clusters = await clusterBySemanticSimilarity(embedded, {
      threshold: 0.85,  // cosine similarity threshold
    });

    // 4. Detect arbitrage within each cluster
    const opportunities: ArbitOpportunity[] = [];
    for (const cluster of clusters) {
      const arbOps = detectArbitrageInCluster(cluster);
      opportunities.push(...arbOps);
    }

    // 5. Score and rank opportunities
    const ranked = opportunities
      .filter(op => op.spread >= config.minSpread)
      .filter(op => op.confidence >= 0.90)
      .filter(op => op.expectedProfit >= config.minProfitUsdt)
      .sort((a, b) => b.expectedProfit - a.expectedProfit);

    // 6. LLM validates top opportunities (hallucination check)
    if (ranked.length > 0) {
      const validated = await llmValidateOpportunity(ranked[0]);
      if (validated.approve) {
        // 7. Simulate before executing
        const simResult = await simulateTrade(ranked[0]);
        if (simResult.success && simResult.netProfit > 0) {
          // 8. Execute delta-neutral arbit trade
          const tx = await executeArbitTrade(ranked[0], config);
          log("Arbit executed:", tx.hash, "Expected P&L:", ranked[0].expectedProfit);
        }
      }
    }

    // 9. Check yield rotation opportunities
    await checkAndRotateYield(config);

    await sleep(config.scanIntervalMs); // 10-30s intervals
  }
}
```

### Key Integrations

| Integration | Purpose | Detail |
|---|---|---|
| Opinion CLOB SDK | Read order books, place/cancel orders | TypeScript SDK, hybrid off-chain matching + on-chain settlement, CTF at `0xAD1a38cEc043e70E83a3eC30443dB285ED10D774` |
| Predict.fun SDK | Read order books, trade outcomes | TypeScript/Python SDK (`@predictdotfun/sdk`), CTF Exchange + NegRisk CTF Exchange, USDT collateral |
| Probable AMM | Swap outcome tokens, read pool state | Zero-fee AMM via PancakeSwap integration, UMA Optimistic Oracle, auto-converts any deposit to USDT |
| XO Market | Read bonding curve prices, trade | Permissionless market creation, AI-driven oracle, Celestia DA rollup |
| Bento | Read social/UGC markets | Early access stage, user-generated market designs |
| OpenAI GPT-4o-mini | Event matching, opportunity validation | Semantic reasoning about event equivalence and risk |
| ChromaDB + e5-large-v2 | Fast semantic search for event matching | Vector embeddings for market description similarity |
| Chainlink Price Feeds | USD pricing for gas cost calculation | BNB/USD feed on BSC |
| The Graph | Index on-chain events across protocols | Custom subgraph for cross-protocol position tracking |

## Core Mechanism Design

### 1. Cross-Market Arbitrage Detection

**The fundamental principle:** If the same binary event is priced differently across two markets, you can buy the underpriced outcome on one market and the opposite outcome on the other. If combined cost < $1.00, the profit is guaranteed regardless of the outcome.

```
Market A (Opinion):   "BTC > $150K by June"  YES = $0.62  NO = $0.38
Market B (Predict):   "BTC > $150K by June"  YES = $0.55  NO = $0.45

Strategy: Buy YES on Predict ($0.55) + Buy NO on Opinion ($0.38)
Total cost: $0.55 + $0.38 = $0.93

If BTC > $150K:   YES on Predict pays $1.00 → Profit = $1.00 - $0.93 = $0.07 (7.5% ROI)
If BTC <= $150K:  NO on Opinion pays $1.00  → Profit = $1.00 - $0.93 = $0.07 (7.5% ROI)

Risk-free profit: $0.07 per $0.93 deployed = 7.5% regardless of outcome.
```

**Detection formula:**

```
spread = 1.0 - (best_yes_price_across_markets + best_no_price_across_markets)

If spread > 0:
  profit_per_dollar = spread / (best_yes + best_no)
  net_profit = spread * position_size - gas_costs - protocol_fees

  If net_profit > min_threshold:
    EXECUTE
```

**Accounting for fees:**

```
Opinion:  Maker 0%, Taker dynamic (probability-linked, ~1-3%)
Predict:  Variable fees
Probable: 0% fees (zero-fee model)
Gas:      ~$0.01 per tx on BSC, ~$0.001 on opBNB

Min profitable spread = sum_of_taker_fees + (2 * gas_cost) + profit_margin
Typical min: ~3-5% spread after accounting for all costs
```

### 2. Delta-Neutral Position Management

A delta-neutral position has zero exposure to the event outcome. The agent constructs these by holding complementary positions across markets:

```
Delta-Neutral Position:
  +1 YES on Market A (exposure: +1 to event)
  +1 NO  on Market B (exposure: -1 to event)
  Net delta: 0

Position P&L Matrix:
┌──────────────┬─────────────────┬────────────────┬───────────┐
│ Outcome      │ Leg A (YES @ A) │ Leg B (NO @ B) │ Net P&L   │
├──────────────┼─────────────────┼────────────────┼───────────┤
│ Event = YES  │ +$1.00 - costA  │ $0.00 - costB  │ 1-costA-B │
│ Event = NO   │ $0.00 - costA   │ +$1.00 - costB │ 1-costA-B │
└──────────────┴─────────────────┴────────────────┴───────────┘

As long as costA + costB < $1.00, profit is guaranteed.
```

**Handling AMM slippage for large positions:**

```typescript
function calculateOptimalSize(
  opportunity: ArbitOpportunity,
  maxSlippageBps: number
): number {
  // For CLOB markets: use order book depth
  const clobDepth = Math.min(
    opportunity.marketA.yesLiquidity,
    opportunity.marketB.noLiquidity
  );

  // For AMM markets: calculate size before price impact exceeds spread
  // AMM price impact ≈ tradeSize / (2 * poolReserves)
  // Max trade size where impact < spread / 2
  const ammMaxSize = opportunity.marketB.type === "amm"
    ? opportunity.marketB.reserves * opportunity.spread
    : Infinity;

  return Math.min(clobDepth, ammMaxSize, config.maxPositionSize);
}
```

### 3. Yield Rotation Strategy

Beyond pure arbitrage, the agent optimizes capital allocation across markets based on risk-adjusted yields:

```
Yield Sources:
1. Open spread capture (arbitrage P&L on resolution)
2. Predict.fun DeFi yield on locked collateral
3. Market-making spread on low-liquidity markets
4. Time-decay on mispriced events approaching expiry

Rotation Logic:
┌──────────────────────────────────────────────────────┐
│ For each unit of available capital:                   │
│                                                      │
│ 1. Score all open opportunities:                     │
│    score = expected_return / time_to_resolution      │
│            * liquidity_factor                        │
│            * (1 - oracle_risk_discount)              │
│                                                      │
│ 2. Rank by risk-adjusted annualized yield            │
│                                                      │
│ 3. Allocate capital proportional to score            │
│    (Kelly criterion for position sizing)             │
│                                                      │
│ 4. Re-evaluate every scan cycle                      │
│    - If better opportunity found, exit lower-yield   │
│      position (if exit cost < yield differential)    │
└──────────────────────────────────────────────────────┘
```

**Kelly Criterion for position sizing:**

```typescript
function kellySize(
  probability: number,    // Agent's estimated true probability
  marketPrice: number,    // Current market price
  bankroll: number        // Available capital
): number {
  // Kelly fraction = (p * b - q) / b
  // where b = (1/price - 1) = payout odds, q = 1-p
  const b = (1 / marketPrice) - 1;
  const q = 1 - probability;
  const kellyFraction = (probability * b - q) / b;

  // Half-Kelly for safety
  const halfKelly = Math.max(0, kellyFraction / 2);
  return halfKelly * bankroll;
}
```

## AI Agent Architecture

### 1. Semantic Event Matching

The hardest problem: determining that "Will Trump win the 2028 election?" on Opinion is the same event as "Republican nominee wins US presidency 2028" on Probable. The agent uses a two-stage approach.

**Stage 1: Vector Embedding Search (Fast Filter)**

```typescript
async function clusterBySemanticSimilarity(
  markets: MarketQuote[],
  config: { threshold: number }
): Promise<MarketQuote[][]> {
  // Embed all market descriptions using e5-large-v2
  const embeddings = await sentenceTransformer.encode(
    markets.map(m => `query: ${m.eventDescription}`)
  );

  // Store in ChromaDB for fast nearest-neighbor search
  await chromaCollection.upsert({
    ids: markets.map(m => `${m.protocol}:${m.marketId}`),
    embeddings,
    metadatas: markets.map(m => ({
      protocol: m.protocol,
      yesPrice: m.yesPrice,
      expiresAt: m.expiresAt,
    })),
  });

  // For each market, find semantically similar markets on OTHER protocols
  const clusters: MarketQuote[][] = [];
  const clustered = new Set<string>();

  for (const market of markets) {
    const key = `${market.protocol}:${market.marketId}`;
    if (clustered.has(key)) continue;

    const results = await chromaCollection.query({
      queryEmbeddings: [market.embedding!],
      nResults: 10,
      where: { protocol: { $ne: market.protocol } },
    });

    const cluster = [market];
    for (const match of results) {
      if (match.distance < (1 - config.threshold)) {
        cluster.push(findMarket(match.id));
        clustered.add(match.id);
      }
    }

    if (cluster.length > 1) {
      clusters.push(cluster);
      clustered.add(key);
    }
  }

  return clusters;
}
```

**Stage 2: LLM Verification (Precision Check)**

```typescript
async function llmValidateEventMatch(
  marketA: MarketQuote,
  marketB: MarketQuote
): Promise<{ match: boolean; confidence: number; reasoning: string }> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{
      role: "system",
      content: `You are a prediction market analyst. Determine if two markets
refer to the EXACT same real-world event with the SAME resolution criteria.

CRITICAL: Markets must resolve identically. "BTC > $150K by June 30" and
"BTC > $150K by July 1" are DIFFERENT markets (different deadlines).

Respond with JSON: { "match": boolean, "confidence": 0-1, "reasoning": string,
"resolution_risk": "low"|"medium"|"high" }`
    }, {
      role: "user",
      content: `Market A (${marketA.protocol}):
  Description: ${marketA.eventDescription}
  Expires: ${new Date(marketA.expiresAt * 1000).toISOString()}
  Current YES price: ${marketA.yesPrice}

Market B (${marketB.protocol}):
  Description: ${marketB.eventDescription}
  Expires: ${new Date(marketB.expiresAt * 1000).toISOString()}
  Current YES price: ${marketB.yesPrice}

Are these the EXACT same event? Would buying YES on A and NO on B
constitute a risk-free hedge?`
    }],
  });

  return JSON.parse(response.choices[0].message.content!);
}
```

### 2. Price Discrepancy Analysis

The agent normalizes prices across different market architectures:

```typescript
interface NormalizedOdds {
  yesImpliedProb: number;  // 0-1
  noImpliedProb: number;   // 0-1
  overround: number;       // Sum of implied probs (>1 means vig exists)
  trueYesProb: number;     // Adjusted for overround
  depth: number;           // USDT available at this price level
}

function normalizeFromCLOB(
  bestBidYes: number,
  bestAskYes: number,
  bestBidNo: number,
  bestAskNo: number
): NormalizedOdds {
  // CLOB: Use midpoint of bid-ask as implied probability
  const yesMid = (bestBidYes + bestAskYes) / 2;
  const noMid = (bestBidNo + bestAskNo) / 2;
  const overround = yesMid + noMid;
  return {
    yesImpliedProb: yesMid,
    noImpliedProb: noMid,
    overround,
    trueYesProb: yesMid / overround,  // Remove vig
    depth: Math.min(bidDepthYes, bidDepthNo),
  };
}

function normalizeFromAMM(
  reserveYes: number,
  reserveNo: number
): NormalizedOdds {
  // AMM (constant product): price = opposite_reserve / total_reserves
  const total = reserveYes + reserveNo;
  const yesPrice = reserveNo / total;
  const noPrice = reserveYes / total;
  return {
    yesImpliedProb: yesPrice,
    noImpliedProb: noPrice,
    overround: 1.0,  // AMM always sums to 1
    trueYesProb: yesPrice,
    depth: Math.sqrt(reserveYes * reserveNo) * 0.1,  // ~10% of pool
  };
}

function normalizeFromBondingCurve(
  currentPrice: number,
  supply: number,
  curveParams: { k: number; m: number }
): NormalizedOdds {
  // Bonding curve: price = k * supply^m
  // Implied probability = price (for YES token) assuming full collateral backing
  return {
    yesImpliedProb: currentPrice,
    noImpliedProb: 1 - currentPrice,
    overround: 1.0,
    trueYesProb: currentPrice,
    depth: estimateBondingCurveDepth(currentPrice, supply, curveParams),
  };
}
```

### 3. Position Sizing & Risk Assessment

```typescript
async function llmAssessRisk(
  opportunity: ArbitOpportunity
): Promise<{ riskScore: number; adjustedSize: number; concerns: string[] }> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{
      role: "system",
      content: `You are a quantitative risk analyst for prediction market arbitrage.
Assess the risk of this arbitrage opportunity. Consider:
1. Oracle divergence risk (different oracles may resolve differently)
2. Resolution timing risk (markets may resolve at different times)
3. Liquidity risk (can we exit if needed?)
4. Smart contract risk (how established is each protocol?)
5. Event ambiguity risk (could the event resolve differently on each platform?)

Respond with JSON: { "riskScore": 0-1, "recommendedSizeMultiplier": 0-1,
"concerns": string[], "oracleRisk": "low"|"medium"|"high" }`
    }, {
      role: "user",
      content: `Opportunity:
  Event: ${opportunity.eventCluster}
  Market A: ${opportunity.marketA.protocol} @ ${opportunity.marketA.yesPrice}
  Market B: ${opportunity.marketB.protocol} @ ${opportunity.marketB.noPrice}
  Spread: ${(opportunity.spread * 100).toFixed(1)}%
  Liquidity: $${opportunity.maxPositionSize}

  Protocol A oracle: ${getOracleType(opportunity.marketA.protocol)}
  Protocol B oracle: ${getOracleType(opportunity.marketB.protocol)}

What is the risk assessment?`
    }],
  });

  const assessment = JSON.parse(response.choices[0].message.content!);
  return {
    riskScore: assessment.riskScore,
    adjustedSize: opportunity.maxPositionSize * assessment.recommendedSizeMultiplier,
    concerns: assessment.concerns,
  };
}
```

## Safety Mechanisms

### Spending Limits

| Mechanism | Layer | Detail |
|---|---|---|
| Per-position size cap | On-chain (`maxPositionSize` in AgentConfig) | Default: 500 USDT per arbit position |
| Total exposure cap | On-chain (`maxTotalExposure`) | Default: 5,000 USDT aggregate across all open positions |
| Daily trade count limit | On-chain (`maxDailyTrades`) | Default: 50 trades per 24h rolling window |
| Daily loss limit | On-chain (`maxDailyLoss`) | Default: 200 USDT max realized loss per 24h |
| Minimum spread threshold | Off-chain (agent config) | Default: 3% min spread to open position (covers fees + gas) |
| Cooldown between trades | On-chain (`cooldownSeconds`) | Default: 60s between executions |

### Circuit Breakers

1. **Loss breaker**: Cumulative daily realized losses exceed `maxDailyLoss` → agent pauses, emits `CircuitBreakerTriggered`, requires owner to manually resume
2. **Trade frequency breaker**: More than `maxDailyTrades` in 24h → agent blocked at contract level
3. **Slippage breaker**: If executed price deviates >2% from quoted price during simulation → trade aborted
4. **Partial fill breaker**: If one leg fills but the other fails → agent attempts to unwind filled leg within 30s, reverts to manual intervention if unwind fails
5. **Oracle divergence breaker**: If the same event resolves differently on two protocols (detected post-resolution) → flag all future cross-protocol arbs involving those protocols, alert operator

### Slippage Protection

```typescript
async function simulateTrade(
  opportunity: ArbitOpportunity
): Promise<SimulationResult> {
  // 1. Simulate leg A via eth_call
  const simA = await publicClient.simulateContract({
    address: vaultAddress,
    abi: ProphitVaultABI,
    functionName: "openProphitPosition",
    args: [/* ... */],
  });

  // 2. Check simulated output vs expected
  const slippageA = Math.abs(simA.sharesReceived - expectedSharesA) / expectedSharesA;
  const slippageB = Math.abs(simB.sharesReceived - expectedSharesB) / expectedSharesB;

  if (slippageA > config.maxSlippage || slippageB > config.maxSlippage) {
    return { success: false, reason: "SLIPPAGE_EXCEEDED" };
  }

  // 3. Verify net profit after actual costs
  const netProfit = (simA.sharesReceived + simB.sharesReceived)
    - (opportunity.marketA.yesPrice * positionSize)
    - (opportunity.marketB.noPrice * positionSize)
    - estimatedGasCost;

  return { success: netProfit > 0, netProfit, slippageA, slippageB };
}
```

### Emergency Controls

- **Owner pause**: `ProphitVault.pause()` -- freezes all agent activity instantly
- **Agent revoke**: `ProphitVault.setAgentAddress(address(0))` -- permanently disables agent
- **Manual position exit**: Owner can call `closePosition()` directly to unwind any position
- **Funds withdrawal**: Owner can withdraw all undeployed USDT at any time via `withdraw()`

## User Flow

### Step 1: Deploy Vault (30 seconds)
Connect wallet (MetaMask/Rabby) to BSC → "Create ProphitVault" → Deploy vault contract → Deposit USDT (e.g., 2,000 USDT)

### Step 2: Configure Agent Parameters (60 seconds)
Set risk parameters:
- Max position size: 500 USDT
- Max total exposure: 2,000 USDT
- Min spread threshold: 3%
- Max daily trades: 50
- Max daily loss: 200 USDT
- Scan interval: 15 seconds

### Step 3: Review Arbitrage Scanner (30 seconds)
Dashboard displays live cross-market arbitrage opportunities sorted by expected profit. User sees: "BTC > $150K by June | Opinion 62% vs Predict 55% | Spread: 7% | Est. profit: $35 on $500"

### Step 4: Start Agent (10 seconds)
Click "Start Agent" → Agent begins autonomous scanning and execution loop → First trades visible within 1-2 scan cycles

### Step 5: Monitor & Control (Ongoing)
- Watch live trade feed with P&L per position
- View aggregate portfolio: total deployed, total P&L, positions by protocol
- Yield rotation suggestions: "Move $300 from Probable (2.1% APY) to Predict (4.8% APY)"
- Pause agent, adjust parameters, or withdraw capital at any time

### Step 6: Position Resolution
- Markets resolve → agent automatically redeems winning conditional tokens → USDT returned to vault
- P&L attributed per position in audit trail
- Capital recycled into new opportunities

## 48-Hour Build Plan

**Team**: Person A (Contracts + Adapters), Person B (Frontend + Dashboard), Person C (AI Agent + Protocol Integration)

### Day 1 -- Foundation (14 hours)

| Time | Person A (Contracts) | Person B (Frontend) | Person C (Agent + Integration) |
|---|---|---|---|
| 0-2 | Foundry project setup, deploy `ProphitVault.sol` skeleton with `AgentConfig` and circuit breakers, unit test spend limits | Next.js 14 + Tailwind + shadcn scaffold, wallet connect (wagmi + BSC), layout with 6 screen tabs | Agent loop skeleton in TypeScript, set up OpenAI integration, ChromaDB + e5-large-v2 for embeddings |
| 2-4 | Implement `IProtocolAdapter` interface, build `OpinionAdapter.sol` wrapping CTF at `0xAD1a38...`, test split/merge/redeem flow | Arbitrage Scanner screen: table with mock data (event, protocol A, protocol B, spread, profit), sortable columns | Opinion CLOB SDK integration (`opinion-clob-sdk` npm): fetch all markets, parse order books, get YES/NO prices |
| 4-6 | Build `PredictAdapter.sol` wrapping Predict.fun CTF Exchange, implement `buyOutcome`/`sellOutcome`/`redeem` | Agent Control Panel: start/stop toggle, risk parameter form (sliders for max position, min spread, daily limits) | Predict.fun SDK integration (`@predictdotfun/sdk`): fetch markets, parse quotes, place test orders on testnet |
| 6-8 | Build `ProbableAdapter.sol` for AMM interaction, implement `getQuote` using reserve ratios, test zero-fee swaps | Active Positions screen: position cards with leg details, P&L bar, resolution countdown timer | Semantic event matching pipeline: embed market descriptions, cluster by similarity, verify with LLM |
| 8-10 | Deploy all contracts to BSC testnet, wire `ProphitVault` → adapters, test `openProphitPosition` end-to-end | Wire frontend to contracts: read positions from `ProphitVault`, display real agent config, show on-chain events | Wire agent to on-chain: build calldata for `openProphitPosition`, simulate via `eth_call`, sign and submit |
| 10-14 | **ALL THREE**: Integration test. Full flow: agent detects 5%+ spread between Opinion testnet mock and Predict testnet → builds arbit trade → submits → vault records position → dashboard shows it. Debug until working. |

**Day 1 Milestone: First successful cross-market arbitrage trade on BSC testnet, visible in dashboard**

### Day 2 -- Polish + Demo (14 hours)

| Time | Person A | Person B | Person C |
|---|---|---|---|
| 14-16 | Circuit breaker tests (fuzz test daily limits, slippage rejection, partial fill handling), gas optimization | Audit Trail screen: event log from contract, decoded calldata, BscScan deeplinks, filtering | Yield rotation logic: score open positions by risk-adjusted return, implement capital reallocation |
| 16-18 | Deploy to BSC **mainnet**, verify contracts on BscScan, fund vault with real USDT (small amount: $50) | Market Unifier screen: unified event list across protocols with matched pairs highlighted, normalized odds | Add Probable adapter to agent (real AMM queries), handle AMM vs CLOB normalization edge cases |
| 18-20 | Add `YieldRotation` event, add `emergencyWithdraw`, final contract hardening | Yield Dashboard: pie chart of capital allocation, APY comparison table, rotation history timeline | Agent reasoning explanations: stream LLM reasoning to frontend via WebSocket, show why agent chose/rejected |
| 20-22 | **ALL THREE**: Execute 2+ real mainnet transactions (requirement). Run demo script 3x. Record backup video. |
| 22-26 | **ALL THREE**: Pitch deck (10 slides), tweet draft with tagged @BNBCHAIN, polish demo flow, handle edge cases |
| 26-28 | Buffer + presentation prep + dry run |

### Critical Path (minimum viable demo)
1. **ProphitVault + 2 adapters** (Opinion + Predict) deployed on testnet (Person A, Hours 0-10)
2. **Agent detects spread + executes trade** across 2 markets (Person C, Hours 0-10)
3. **Dashboard shows the trade happened** with P&L (Person B, Hours 6-14)

Everything else (yield rotation, 3rd adapter, polished UI) is bonus.

## Tech Stack

| Layer | Tools |
|---|---|
| Contracts | Solidity 0.8.24, Foundry, OpenZeppelin 5.x (Ownable, ReentrancyGuard, Pausable), Gnosis CTF |
| Frontend | Next.js 14, wagmi v2, viem, Tailwind, shadcn/ui, Recharts, Lightweight Charts, TanStack Query, Vercel |
| Agent | Node.js 20, TypeScript, OpenAI SDK (GPT-4o-mini), viem, ChromaDB, sentence-transformers (e5-large-v2) |
| Protocol SDKs | `opinion-clob-sdk` (Opinion CLOB), `@predictdotfun/sdk` (Predict.fun), Probable (direct contract via viem) |
| Infra | BSC Mainnet (chain 56) / Testnet (chain 97), opBNB optional, Chainlink Price Feeds, The Graph |

## Demo Strategy (3 minutes)

**0:00-0:30 -- The Problem**
> "There are 5 prediction markets on BNB Chain right now. The same event -- 'Will BTC hit $150K by June?' -- is priced at 62% on Opinion and 55% on Predict.fun. That's a 7% spread. Free money, but nobody is capturing it because these markets don't talk to each other. Prophit fixes this."

**0:30-1:00 -- How It Works (30 seconds)**
Show architecture diagram. Explain: "Our AI agent scans all 5 markets every 15 seconds. It uses semantic embeddings to match equivalent events across platforms, then LLM reasoning to verify the match. When it finds a spread above our threshold, it executes a delta-neutral trade -- buying YES on the cheap market and NO on the expensive one. Guaranteed profit regardless of outcome."

**1:00-2:00 -- Live Demo (60 seconds)**
1. Show vault with 500 USDT on BSC mainnet
2. Open Arbitrage Scanner: highlight a live opportunity (e.g., spread on a crypto price event)
3. Agent auto-detects it: show LLM reasoning stream ("Event match confidence: 97%. Spread: 6.2%. Estimated profit: $31...")
4. Agent executes: two transactions fire (one on each protocol)
5. Dashboard updates: new position appears, P&L shows expected profit
6. Click into Audit Trail: show both BscScan links, decoded calldata

**2:00-2:30 -- Safety Demo (30 seconds)**
1. Show circuit breaker config: "Max 500 USDT per position, 200 USDT daily loss limit"
2. Attempt oversized trade → `POSITION_TOO_LARGE` revert on-chain
3. Show agent paused after hitting daily trade limit: `CircuitBreakerTriggered` event on BscScan

**2:30-3:00 -- Vision**
> "Prophit is the first cross-market arbitrage infrastructure for prediction markets on BNB Chain. We unify fragmented liquidity, improve price discovery across the ecosystem, and let anyone capture spreads that were previously invisible. With the prediction market ecosystem growing 10x on BNB Chain, the arbitrage opportunity will only get larger."

### Key Judge Talking Points
- **Innovation**: First cross-protocol AI arbitrage agent for prediction markets on any chain. Novel semantic event matching + delta-neutral execution
- **Design/Usability**: One-click vault deployment, visual spread scanner, real-time P&L -- non-technical users can run a hedge fund strategy
- **Scalability**: Modular adapter pattern -- adding a 6th protocol is a single new adapter contract + SDK integration. opBNB for sub-cent gas on high-frequency scanning
- **Ecosystem Integration**: Deep integration with all 5 BNB Chain prediction market protocols (Opinion, Predict.fun, Probable, XO Market, Bento). Uses Chainlink, The Graph, PancakeSwap ecosystem
- **Open Source**: All contracts, agent code, and adapters MIT-licensed on GitHub

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Opinion/Predict SDKs break or rate-limit during hackathon | Medium | High | Pre-cache market data. Build direct RPC fallback (read contract state via `eth_call`). Test rate limits in first 2 hours. |
| Insufficient spread on real markets during demo | Medium | High | Seed 2 test markets with intentional mispricing ($50 each side). If real spread exists, use it; if not, use seeded markets. |
| LLM incorrectly matches two different events | Low | Critical | Require >95% confidence for auto-execution. Always show reasoning in UI. For demo, use pre-validated event pairs. |
| Oracle divergence: same event resolves YES on A, NO on B | Low | Critical | Only arb between protocols using same oracle (e.g., both UMA), or require LLM to flag oracle-mismatch risk >0.3. |
| Partial fill: one leg executes, other fails | Medium | Medium | Attempt immediate unwind of filled leg. If unwind fails, position is directional -- alert operator for manual exit. |
| Gas spikes on BSC during execution | Low | Low | Set max gas price in agent config. BSC gas is stable (~$0.01). opBNB as fallback for <$0.001 gas. |
| OpenAI rate limits during demo | Low | Medium | Cache LLM responses for known event pairs. Pre-warm with 20 event matches. Backup: local LLM (Ollama + Mistral 7B). |
| Conditional token redemption fails post-resolution | Low | Medium | Test full lifecycle on testnet (create position → wait for resolution → redeem). Manual redeem function as fallback. |
| Not enough time to build all 5 adapters | High | Low | Prioritize Opinion + Predict.fun (both have TypeScript SDKs). Probable as stretch goal. XO/Bento are "listed as supported" in UI with "coming soon" badge. |

## Post-Hackathon Roadmap

### Phase 1: Foundation (Months 1-2, $50K Kickstart)
- Audit ProphitVault and adapter contracts (Code4rena or Sherlock)
- Deploy on BSC mainnet + opBNB for high-frequency scanning
- Complete all 5 protocol adapters (Opinion, Predict.fun, Probable, XO Market, Bento)
- Launch public beta: users deposit USDT, agent runs strategies
- Target: $100K TVL, 50+ arbitrage trades executed

### Phase 2: Agent Marketplace (Months 3-4)
- **Strategy Marketplace**: Community-submitted arbitrage strategies (not just cross-market, also intra-market patterns like time-decay, volatility)
- **Multi-agent support**: Multiple agents per vault with isolated budgets
- **Advanced analytics**: Historical spread data, protocol-level risk scoring, P&L attribution
- **Cross-chain expansion**: Bridge arbitrage between BNB Chain prediction markets and Polymarket (Polygon), Drift (Solana)
- Apply to MVB Accelerator via EASY Residency fast-track

### Phase 3: Protocol Layer (Months 5-8)
- **Prophit SDK** (npm package): Any developer can build custom arbitrage strategies on top
- **Liquidity aggregation protocol**: Not just arbing spreads, but routing orders to best-priced market (like 1inch for prediction markets)
- **Fee activation**: 0.5% of arbitrage profits (pure upside -- no fee if no profit)
- **Governance**: Token for parameter voting (min spread thresholds, supported protocols, risk limits)
- Target: $1M+ in arbitrage volume processed

### Phase 4: Infrastructure (Months 9-12)
- Default arbitrage and liquidity layer for BNB Chain prediction market ecosystem
- **Market efficiency oracle**: Publish cross-market consensus probability as a public good
- **Institutional API**: Quant funds and market makers can plug into Prophit's data + execution layer
- **MEV protection**: Integrate with BSC's emerging MEV infrastructure to prevent frontrunning of arbit trades
- Target: $10M+ monthly arbitrage volume, profitable protocol economics
