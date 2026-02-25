Pre-Launch Testing Plan
======================

Status: **Draft** | Created: 2026-02-24

This document covers every functionality that must be verified before going live.
Tests are grouped by subsystem and ordered by risk (highest first).

---

## Test Environment Requirements

| Resource | Required For | Setup |
|----------|-------------|-------|
| BSC RPC (mainnet or testnet) | All on-chain tests | `RPC_URL` env var |
| Funded EOA wallet | CLOB execution, approvals | `PRIVATE_KEY` with BNB + USDT balance |
| Safe proxy (optional) | Probable Safe mode | `PROBABLE_PROXY_ADDRESS` — 1-of-1 Safe owned by EOA |
| Predict API key | Predict provider, discovery | `PREDICT_API_KEY` |
| Probable API access | Probable provider, discovery | Public (no key needed) |
| OpenAI API key | Semantic matching (optional) | `OPENAI_API_KEY` |

---

## 1. CLOB Order Lifecycle (CRITICAL)

The core revenue path. Every step must work end-to-end.

### 1.1 Authentication

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 1.1.1 | Predict JWT auth | Run `validate-signing --platform predict` | JWT obtained, logged with truncated key |
| 1.1.2 | Predict JWT refresh | Place order, wait >5 min, place another | Second order succeeds without manual re-auth |
| 1.1.3 | Predict 401 retry | Invalidate JWT (wait for expiry), call `getOpenOrders()` | Re-auths once, returns orders (no infinite loop) |
| 1.1.4 | Probable L1 auth (EIP-712) | Run `validate-signing --platform probable` | API key + secret + passphrase obtained |
| 1.1.5 | Probable L2 HMAC auth | Place order after auth | HMAC signature accepted, order placed |
| 1.1.6 | Probable auth fallback | If `POST /auth/api-key` fails, `GET /derive-api-key` is tried | Logs show fallback, credentials still obtained |

### 1.2 Order Placement

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 1.2.1 | Predict MARKET order | Place small order ($1), check order type in API response | `strategy: "MARKET"` in request payload |
| 1.2.2 | Probable FOK order | Place small order ($1), check order type in API response | `orderType: "FOK"` in request payload |
| 1.2.3 | Predict per-market exchange | Place order on a NegRisk market | Correct exchange address resolved (not default) |
| 1.2.4 | Nonce increments on success | Place order, check nonce, place another | Nonce increments by 1 after each successful order |
| 1.2.5 | Nonce stable on failure | Place order that fails (bad token ID) | Nonce does NOT increment |
| 1.2.6 | Dry-run mode | `DRY_RUN=true`, place order | No API call made, returns `orderId: "dry-run"` |
| 1.2.7 | Both legs placed in parallel | Trigger arb execution, check logs | Both `placeOrder` calls fire concurrently |
| 1.2.8 | One leg fails, other cancelled | Force one platform to reject (bad token ID) | Surviving order is cancelled, no position opened |
| 1.2.9 | Predict CollateralPerMarket error | Place order exceeding per-market collateral limit | Returns `{ success: false }`, NOT retried (fetch called once) |

### 1.3 Fill Polling

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 1.3.1 | Both legs fill | Place two matching orders, wait | Position status becomes `FILLED` |
| 1.3.2 | Both legs expire | Place two orders at extreme prices (won't fill) | Position status becomes `EXPIRED` after timeout |
| 1.3.3 | Partial fill + unwind | One leg fills, other expires | Executor pauses, unwind SELL order placed at 95% price |
| 1.3.4 | Unwind fills, auto-unpause | After 1.3.3, unwind order fills | `executor.paused` resets to `false`, logs confirm |
| 1.3.5 | Unwind fails, stays paused | After partial, unwind order also expires | Executor remains paused, critical error logged |
| 1.3.6 | Poll timeout handling | Set `FILL_POLL_TIMEOUT_MS=10000`, place slow orders | Unfilled legs cancelled at timeout, position marked EXPIRED |
| 1.3.7 | Status mapping correct | Check `getOrderStatus()` for each platform | MATCHED/FILLED->FILLED, LIVE/OPEN->OPEN, etc. |

### 1.4 Approvals

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 1.4.1 | CTF ERC-1155 approval (Predict) | Fresh wallet, run agent | `setApprovalForAll` tx sent, receipt awaited |
| 1.4.2 | CTF ERC-1155 approval (Probable) | Fresh wallet, run agent | `setApprovalForAll` tx sent, receipt awaited |
| 1.4.3 | USDT ERC-20 approval (Predict) | Fresh wallet, run agent | `approve(max)` tx sent, receipt awaited |
| 1.4.4 | USDT ERC-20 approval (Probable) | Fresh wallet, run agent | `approve(max)` tx sent, receipt awaited |
| 1.4.5 | Skip if already approved | Run agent twice | Second startup skips approval txs |
| 1.4.6 | Reverted approval handled | Simulate revert (insufficient gas) | Warning logged, agent continues (doesn't crash) |
| 1.4.7 | Safe-mode approvals via execTransaction | Set `PROBABLE_PROXY_ADDRESS`, fresh Safe | CTF + USDT approvals sent through Safe's `execTransaction` |

### 1.5 Safe Configuration Validation

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 1.5.1 | Safe threshold must be 1 | Set `PROBABLE_PROXY_ADDRESS` to a 2-of-3 Safe | Agent fails startup with "threshold is 2, expected 1" |
| 1.5.2 | EOA must be Safe owner | Set `PROBABLE_PROXY_ADDRESS`, use different `PRIVATE_KEY` | Agent fails startup with "not an owner of Safe" |
| 1.5.3 | Valid Safe passes | Correctly configured 1-of-1 Safe | "Safe validation passed" logged with threshold, owner count, EOA |
| 1.5.4 | Auto-fund when Safe balance low | Safe USDT < `MAX_POSITION_SIZE`, EOA has USDT | Transfer tx sent from EOA to Safe, receipt confirmed |
| 1.5.5 | Skip auto-fund when balance sufficient | Safe USDT >= `MAX_POSITION_SIZE` | "Safe USDT balance sufficient" logged, no transfer |
| 1.5.6 | EOA insufficient for auto-fund | Safe USDT low, EOA USDT also low | Warning logged, agent continues (Predict-only trades possible) |

### 1.6 Startup Balance Checks

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 1.6.1 | BNB balance = 0 | Empty wallet | `STARTUP CHECK: EOA BNB balance is 0` error logged |
| 1.6.2 | BNB balance low (< 0.01) | Wallet with 0.005 BNB | `STARTUP CHECK: EOA BNB balance is low` warning |
| 1.6.3 | BNB balance OK | Wallet with >= 0.01 BNB | `STARTUP CHECK: EOA BNB balance OK` info |
| 1.6.4 | EOA USDT balance = 0 | No USDT in wallet | `STARTUP CHECK: EOA USDT balance is 0` warning |
| 1.6.5 | EOA USDT balance logged | Wallet with USDT | `STARTUP CHECK: EOA USDT balance` info with amount |
| 1.6.6 | Safe USDT balance checked | `PROBABLE_PROXY_ADDRESS` set | `STARTUP CHECK: Safe USDT balance` logged |
| 1.6.7 | No Safe check without proxy | No `PROBABLE_PROXY_ADDRESS` | Safe balance check skipped entirely |
| 1.6.8 | RPC failure non-fatal | RPC down during startup checks | Warnings logged, agent continues to start |

### 1.7 Nonce Persistence

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 1.7.1 | Nonce saved after trade | Execute trade, check `agent-state.json` | `clobNonces` contains current nonce for both clients |
| 1.7.2 | Nonce restored on restart | Kill and restart agent | Nonce resumes from persisted value, no duplicate |
| 1.7.3 | No duplicate orders on crash | Kill mid-trade, restart | No duplicate nonce used (check API open orders) |

---

## 2. Arbitrage Detection (HIGH)

### 2.1 Core Detection Logic

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 2.1.1 | Detects YES_A + NO_B < 1.0 | Feed quotes with known spread | Opportunity found with correct `buyYesOnA=true` |
| 2.1.2 | Detects NO_A + YES_B < 1.0 | Feed quotes with inverse spread | Opportunity found with correct `buyYesOnA=false` |
| 2.1.3 | No false arb when sum >= 1.0 | Feed balanced quotes | Empty result array |
| 2.1.4 | Fee deduction correct | 200bps Predict + 175bps Probable | `spreadBps` = gross - worst-case fee |
| 2.1.5 | Fees can eliminate arb | Tight spread (< fee cost) | Opportunity excluded (spreadBps <= 0) |
| 2.1.6 | Sorted by spread descending | Multiple opportunities | `result[0].spreadBps >= result[1].spreadBps` |
| 2.1.7 | estProfit calculation | Known inputs | `estProfit = REF_AMOUNT * netSpread / 1e18` |
| 2.1.8 | Cross-market detection | Multiple markets, mixed protocols | Only cross-protocol pairs detected (not same-protocol) |

**Status**: All covered by existing unit tests (detector.test.ts). Verify with `npx vitest run`.

### 2.2 Quote Staleness

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 2.2.1 | `quotedAt` populated | Fetch quotes from each provider | Every `MarketQuote` has `quotedAt` within last 30s |
| 2.2.2 | Stale quotes in dry-run | Run dry-run, check log timestamps | Quotes are fresh at time of arb detection |

### 2.3 Deduplication

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 2.3.1 | Same arb not re-traded within 5 min | Run agent, observe two consecutive scans with same arb | First scan trades, second scan skips ("recently traded") |
| 2.3.2 | Arb re-eligible after window | Wait >5 min after trade | Same opportunity can be traded again |

---

## 3. Market Discovery Pipeline (HIGH)

### 3.1 Market Fetching

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 3.1.1 | Probable pagination | Run `list-matches.ts`, check "Probable markets" count | All active markets fetched (compare to website count) |
| 3.1.2 | Predict pagination (markets + categories) | Run `list-matches.ts`, check "Predict markets" count | Markets from both `/v1/markets` and `/v1/categories` included |
| 3.1.3 | Binary market filtering | Check discovered markets | Only YES/NO binary markets (no multi-outcome) |
| 3.1.4 | Token ID extraction (explicit tokens array) | Check a Probable market with `tokens` field | YES/NO token IDs extracted from `tokens[].outcome` |
| 3.1.5 | Token ID extraction (fallback clobTokenIds) | Check a Probable market without `tokens` field | Falls back to `clobTokenIds` parallel array |
| 3.1.6 | API timeout handling | Disconnect network briefly during discovery | Partial results returned, no crash |

### 3.2 Market Matching

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 3.2.1 | conditionId exact match | Check `list-matches.ts` output | Any conditionId matches shown as `matchType: "conditionId"` |
| 3.2.2 | Template match (same entity) | e.g., "Will Anthropic FDV above $1B" on both platforms | Matched as `matchType: "templateMatch"`, similarity: 1.0 |
| 3.2.3 | Template rejects different entities | "Will Ink FDV above $1B" vs "Will Backpack FDV above $1B" | NOT matched (different entity in template key) |
| 3.2.4 | Jaccard fallback for non-template titles | Unique market titles with high overlap | Matched as `matchType: "titleSimilarity"`, similarity >= 0.85 |
| 3.2.5 | Jaccard rejects low similarity | Different topics | Not matched, logged as near-miss if >= 0.50 |
| 3.2.6 | Stop-word filtering active | Template titles with many shared stop-words | Stop words excluded from Jaccard computation |
| 3.2.7 | Zero false positives | Spot-check 20 matches manually | Every match is genuinely the same event on both platforms |
| 3.2.8 | No missed true positives | Compare against manual cross-reference | All obvious same-event pairs are matched |

**Verification command:**
```bash
npx tsx src/scripts/list-matches.ts
```

---

## 4. Quote Fetching (HIGH)

### 4.1 Predict Provider

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 4.1.1 | Orderbook fetch succeeds | Run agent, check logs for Predict quotes | Quotes returned with valid prices |
| 4.1.2 | Asks sorted ascending | Log raw orderbook before/after sort | `sortedAsks[0] <= sortedAsks[1]` |
| 4.1.3 | Bids sorted descending | Log raw orderbook before/after sort | `sortedBids[0] >= sortedBids[1]` |
| 4.1.4 | YES price = best ask | Compare to Predict.fun website | Matches within rounding |
| 4.1.5 | NO price = 1 - best bid | Compare to Predict.fun website | `noPrice = 1e18 - bestBid` |
| 4.1.6 | Fee = 200 bps | Check `feeBps` on returned quote | `feeBps === 200` |
| 4.1.7 | Low liquidity skipped | Market with < $1 depth | Market not in quote results, warning logged |
| 4.1.8 | API error handled | Invalid market ID | Warning logged, other markets still fetched |

### 4.2 Probable Provider

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 4.2.1 | Dual orderbook fetch (YES + NO) | Run agent, check logs | Both orderbooks fetched in parallel |
| 4.2.2 | YES price = best ask (YES book) | Compare to Probable website | Matches within rounding |
| 4.2.3 | NO price = best ask (NO book) | Compare to Probable website | Matches within rounding |
| 4.2.4 | Fee = 175 bps | Check `feeBps` on returned quote | `feeBps === 175` |
| 4.2.5 | Low liquidity skipped | Market with < $1 depth | Market not in quote results, warning logged |
| 4.2.6 | Empty orderbook handled | Market with no asks | `yesPrice = 0`, market skipped |

### 4.3 Phantom Spread Check

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 4.3.1 | Predict complement pricing | Pick market, compare YES ask + (1 - YES bid) | Acknowledge: sum may exceed 1.0 on wide-spread markets |
| 4.3.2 | Cross-provider price sanity | Compare same market on both platforms | Prices within 10% of each other (flagged if not) |

---

## 5. Agent Core Loop (HIGH)

### 5.1 Scan Lifecycle

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 5.1.1 | Scan runs at configured interval | Set `SCAN_INTERVAL_MS=10000`, observe logs | Scans occur ~every 10 seconds |
| 5.1.2 | Scan timeout (120s) | Simulate slow provider (mock) | Scan aborted after 120s, error logged, next scan scheduled |
| 5.1.3 | Provider failure doesn't block scan | Kill one provider's API | Other providers still return quotes, scan completes |
| 5.1.4 | MIN_SPREAD_BPS filter | Set high threshold (e.g., 5000) | Only wide spreads pass (most opportunities filtered) |
| 5.1.5 | Auto-discovery on startup | Set `AUTO_DISCOVER=true` | Markets discovered and loaded before first scan |

### 5.2 Daily Loss Limit

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 5.2.1 | Balance check runs each scan | Check logs for balance reading | USDT balance logged or referenced each scan |
| 5.2.2 | Trade blocked when loss exceeded | Drain balance below limit | Execution skipped, "exceeds daily loss limit" logged |
| 5.2.3 | Balance check failure = skip execution | Disconnect RPC briefly | Balance sentinel (-1n), execution skipped for this scan |
| 5.2.4 | Daily window resets | Wait for midnight UTC crossing | `dailyStartBalance` resets, trading resumes |

### 5.3 Position Management (CLOB)

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 5.3.1 | Filled position tracked | Execute trade in dry-run | `clobPositions` array contains position with FILLED status |
| 5.3.2 | Resolved market detected | Market resolves on-chain | `payoutDenominator > 0` on CTF contract |
| 5.3.3 | Token redemption | Resolved position with token balance | `redeemPositions()` called, USDT received, position CLOSED |
| 5.3.4 | Skip non-FILLED positions | Position with EXPIRED status | Not processed for redemption |

---

## 6. State Persistence (MEDIUM)

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 6.1 | State saved after trade | Execute trade, read `agent-state.json` | Contains `tradesExecuted`, `clobPositions`, `clobNonces` |
| 6.2 | Atomic write (temp + rename) | Check for `.tmp` file during save | No `.tmp` file lingers after save completes |
| 6.3 | State loaded on restart | Kill and restart agent | `tradesExecuted` resumes from previous value |
| 6.4 | BigInt round-trip | Check persisted positions | BigInt fields saved as strings, restored correctly |
| 6.5 | Corrupt file handled | Manually corrupt `agent-state.json` | Agent starts fresh, warns about parse error |
| 6.6 | Missing file handled | Delete `agent-state.json` | Agent starts fresh, no error |

---

## 7. Graceful Shutdown (MEDIUM)

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 7.1 | SIGINT triggers shutdown | Press Ctrl+C during scan | "Shutting down..." logged |
| 7.2 | SIGTERM triggers shutdown | `kill <pid>` during scan | "Shutting down..." logged |
| 7.3 | Open orders cancelled on shutdown | Have open orders, send SIGINT | All open orders cancelled (check both platforms) |
| 7.4 | State flushed before exit | Send SIGINT | `agent-state.json` written with latest state |
| 7.5 | 30-second force-exit | Block shutdown (e.g., unresponsive API) | "Graceful shutdown timed out" logged, `exit(1)` after 30s |
| 7.6 | No new scans during shutdown | Send SIGINT mid-scan | Current scan finishes, no new scan starts |

---

## 8. API Server (MEDIUM)

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 8.1 | `GET /api/status` | `curl localhost:3001/api/status` | Returns running state, trade count, config |
| 8.2 | `GET /api/opportunities` | `curl localhost:3001/api/opportunities` | Returns current arb opportunities (BigInts as strings) |
| 8.3 | `GET /api/clob-positions` | `curl localhost:3001/api/clob-positions` | Returns CLOB positions array |
| 8.4 | `POST /api/agent/stop` | `curl -X POST localhost:3001/api/agent/stop` | Scan loop stops, `{ok: true}` returned |
| 8.5 | `POST /api/agent/start` | `curl -X POST localhost:3001/api/agent/start` | Scan loop resumes |
| 8.6 | `POST /api/config` update | Update `minSpreadBps` via API | Config changes take effect next scan |
| 8.7 | `POST /api/discovery/run` | Trigger discovery via API | Returns discovery result with match counts |
| 8.8 | Auth enforcement | Set `API_KEY`, call without Bearer token | 401 Unauthorized |
| 8.9 | BigInt serialization | Check any endpoint returning prices | No `BigInt serialization` errors |

---

## 9. EIP-712 Signing (MEDIUM)

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 9.1 | Order signed with correct domain (Predict) | Check signing domain | `name: "predict.fun CTF Exchange"` |
| 9.2 | Order signed with correct domain (Probable) | Check signing domain | `name: "Probable CTF Exchange"` |
| 9.3 | Amount scaling 1e18 (both platforms) | Place $10 order, check `makerAmount` | `makerAmount = 10 * 1e18` |
| 9.4 | BUY order amounts | `makerAmount = size`, `takerAmount = size/price` | Matches expected values |
| 9.5 | SELL order amounts | `makerAmount = size/price`, `takerAmount = size` | Matches expected values |
| 9.6 | Salt is random | Place two orders | Different `salt` values |
| 9.7 | Expiration set correctly | `ORDER_EXPIRATION_SEC=300` | `expiration = now + 300` |
| 9.8 | Probable HMAC signature | Inspect L2 auth headers | `Prob_signature` header present, HMAC-SHA256 format |

**Verification command:**
```bash
npx tsx src/scripts/validate-signing.ts --platform both --cancel
```

---

## 10. End-to-End Dry Run (HIGH)

Full system test without real money.

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 10.1 | Full loop with auto-discovery | `AUTO_DISCOVER=true DRY_RUN=true EXECUTION_MODE=clob npx tsx src/index.ts` | Markets discovered, quotes fetched, arbs detected |
| 10.2 | Trade executed in dry-run | Watch logs for "dry-run" | Position created with FILLED status, no real orders |
| 10.3 | Multiple scans complete | Let run for 60+ seconds | Multiple scan cycles without errors |
| 10.4 | State persisted | Check `agent-state.json` after dry-run | Contains trades and positions |
| 10.5 | Graceful shutdown | Ctrl+C during dry-run | Clean shutdown, state saved |
| 10.6 | API accessible during dry-run | `curl localhost:3001/api/status` | Status endpoint returns data |

**Run command:**
```bash
AUTO_DISCOVER=true DRY_RUN=true EXECUTION_MODE=clob \
  PREDICT_API_KEY=<key> PRIVATE_KEY=<key> RPC_URL=<url> CHAIN_ID=56 \
  npx tsx src/index.ts
```

---

## 11. End-to-End Live Test (CRITICAL — before real money)

Minimum viable live test with real orders but tiny size.

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 11.1 | Place $1 arb on testnet/mainnet | Set `MAX_POSITION_SIZE=1000000` (1 USDT) | Both legs placed, positions tracked |
| 11.2 | Both legs fill (FOK/IOC) | Monitor fill status | Position status = FILLED |
| 11.3 | Profit is correct | Check USDT balance change | Gained ~ `spreadBps / 10000 * positionSize` |
| 11.4 | Wait for resolution | Hold position until market resolves | `payoutDenominator > 0` on CTF |
| 11.5 | Redeem tokens | Agent detects resolution | `redeemPositions()` succeeds, USDT returned |
| 11.6 | Net P&L positive | Final balance > starting balance | Profit = payout - cost - gas |

---

## 12. Utility Scripts Verification (LOW)

| # | Test | How to Verify | Pass Criteria |
|---|------|---------------|---------------|
| 12.1 | `list-matches.ts` | `npx tsx src/scripts/list-matches.ts` | Shows matches grouped by type, no errors |
| 12.2 | `auto-discover.ts --dry-run` | `npx tsx src/scripts/auto-discover.ts --dry-run` | Prints env var format without saving |
| 12.3 | `discover-markets.ts` | `npx tsx src/scripts/discover-markets.ts --pages 2` | Saves to `data/predict-markets.json` |
| 12.4 | `probe-probable.ts` | `npx tsx src/scripts/probe-probable.ts` | Lists open orders, cancels each |
| 12.5 | `validate-signing.ts` | `npx tsx src/scripts/validate-signing.ts --platform both --cancel` | Auth + order + cancel on both platforms |

---

## 13. Edge Cases & Failure Modes (MEDIUM)

| # | Scenario | Expected Behavior |
|---|----------|-------------------|
| 13.1 | RPC node goes down mid-scan | Scan fails with timeout, next scan retried |
| 13.2 | Predict API returns 429 (rate limit) | Retry with backoff (3 attempts), logged as warning |
| 13.3 | Probable API returns 500 | Quotes skipped for Probable, other providers continue |
| 13.4 | OpenAI API quota exceeded | Semantic matching disabled, discovery uses Jaccard only |
| 13.5 | Disk full (state save fails) | Error logged, agent continues running (no crash) |
| 13.6 | Market resolves during fill polling | Orders may not fill; timeout handles gracefully |
| 13.7 | Concurrent arb attempts drain balance | Pre-execution balance check prevents second trade |
| 13.8 | Network partition during shutdown | 30-second force-exit timer triggers `exit(1)` |
| 13.9 | Invalid market map JSON | Parse error on startup, agent exits with clear message |
| 13.10 | Agent started without API keys | Validation fails, agent exits before any scan |
| 13.11 | Safe USDT insufficient for Probable leg | Executor skips trade, logs warning with Safe balance vs required |
| 13.12 | CollateralPerMarket on Predict | `postOrder` returns failure (no throw), `withRetry` doesn't retry |
| 13.13 | Safe with threshold > 1 | Agent startup fails fast with clear error message |
| 13.14 | EOA not in Safe owners list | Agent startup fails fast with clear error message |

---

## 14. Existing Unit Test Suite

**197 tests across 11 files — all passing.**

| File | Tests | Coverage Area |
|------|-------|---------------|
| `detector.test.ts` | 11 | Arbitrage detection, fee deduction, sorting |
| `matching.test.ts` | 19 | Cosine similarity, clustering, embedder, verifier, risk assessor |
| `executor-clob.test.ts` | 21 | executeClob, pollForFills, attemptUnwind, closeResolvedClob, Safe balance pre-check |
| `predict-client.test.ts` | 25 | Auth, placeOrder, nonce, approvals, retry logic, CollateralPerMarket handling |
| `probable-client.test.ts` | 28 | Auth, placeOrder, FOK orders, nonce, approvals, Safe validation, auto-funding |
| Other test files | 93 | Persistence, utils, config, pipeline, yield rotation |

**Run command:**
```bash
cd packages/agent && npx vitest run
```

---

## 15. Production Readiness Checklist

Before flipping `DRY_RUN=false`:

- [ ] All Section 1 tests pass (CLOB order lifecycle)
- [ ] All Section 2 tests pass (arbitrage detection)
- [ ] All Section 3 tests pass (discovery pipeline)
- [ ] All Section 4 tests pass (quote fetching)
- [ ] Section 10 dry-run completes cleanly (60+ seconds, multiple scans)
- [ ] Section 11 live test completes ($1 arb, both legs fill)
- [ ] `validate-signing.ts --platform both --cancel` succeeds
- [ ] `list-matches.ts` shows 0 false positives
- [ ] API endpoints respond correctly (Section 8)
- [ ] Graceful shutdown works (Section 7)
- [ ] State persistence round-trip verified (Section 6)
- [ ] Wallet has sufficient USDT balance for `MAX_POSITION_SIZE * 2` (or `MAX_POSITION_SIZE` if Safe covers the Probable leg)
- [ ] If using Safe mode: `PROBABLE_PROXY_ADDRESS` set, Safe threshold=1, EOA is owner
- [ ] If using Safe mode: Safe has sufficient USDT (or auto-funding will cover it)
- [ ] Startup balance checks show no errors (`STARTUP CHECK:` logs on boot)
- [ ] `API_KEY` set for production (authenticated API)
- [ ] `DAILY_LOSS_LIMIT` set to acceptable value
- [ ] `MIN_SPREAD_BPS` set to profitable threshold (accounting for gas)
- [ ] Monitoring: operator has access to logs (no metrics system yet — Issue #16)

---

## Known Deferred Risks

These are consciously accepted and documented in ISSUES.md:

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 13 | Floating-point in buildOrder | Low | Safe up to ~$90M, max position is $500 |
| 14 | Max uint256 approvals | Low | Standard DeFi practice |
| 16 | No metrics/alerting | Medium | Operator watches logs; add post-launch |
| — | Predict complement pricing (phantom spread) | Medium | Documented in code; conservative fee deduction mitigates |
| — | Embedding cache unbounded | Low | Restarts clear cache; memory usage negligible at current scale |
| — | No circuit breaker on repeated failures | Medium | Daily loss limit + operator monitoring |
