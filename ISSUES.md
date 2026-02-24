CLOB Mode Pre-Production Audit
==============================

Summary
-------

| Area                 | Status          | Blockers                              |
|----------------------|-----------------|---------------------------------------|
| Discovery & Matching | Good            | None                                  |
| Quote Fetching       | Fixed           | None                                  |
| Arbitrage Detection  | Fixed           | None                                  |
| CLOB Execution       | Fixed           | None                                  |
| Risk Management      | Fixed           | None                                  |
| State Persistence    | Fixed           | None                                  |
| Test Coverage        | Poor for CLOB   | Zero integration tests for order lifecycle |

---

CRITICAL — all fixed

1. ~~Partial fill leaves agent paused forever~~ **FIXED** — `attemptUnwind()` now polls for unwind order fill (10s intervals, 5 min timeout). Auto-unpauses on fill.
2. ~~Nonce can desync on crash~~ **FIXED** — `saveState()` called immediately after each trade execution, before scan loop continues.
3. ~~Predict client has recursive auth hang~~ **FIXED** — `getOpenOrders()` and `getOrderStatus()` use max-retry pattern (re-auth once, then fail) instead of recursive calls.
4. ~~Balance check fails open~~ **FIXED** — Balance check failure now sets sentinel (-1n) that fails the loss check. Agent skips execution when balance is unknown.
5. ~~Approval txs not awaited~~ **FIXED** — Both Predict and Probable clients now `waitForTransactionReceipt()` after approval txs (CTF + USDT).

---

HIGH — all fixed

6. ~~No quote staleness validation~~ **FIXED** — `quotedAt: number` added to `MarketQuote`. All providers populate it with `Date.now()`.
7. ~~Fee rates hardcoded~~ **FIXED** — Probable changed from 0bps to 175bps (real minimum). Predict kept at 200bps (confirmed minimum) with TODO to fetch per-market rates.
8. ~~Predict orderbook sort not guaranteed~~ **FIXED** — Asks sorted ascending, bids sorted descending before best-price selection.
9. ~~No shutdown timeout~~ **FIXED** — 30s force-exit timer added to `shutdown()`. Timer is `.unref()`'d.
10. ~~Scan loop doesn't timeout~~ **FIXED** — Scan body wrapped in `withTimeout()` with 120s limit.
11. ~~Token ID order assumption~~ **FIXED** — Discovery pipeline now prefers explicit `market.tokens` array (with `outcome` field) over positional `clobTokenIds`. Falls back to old approach if `tokens` is empty.

---

MEDIUM — partially fixed

12. ~~GTC orders instead of IOC~~ **FIXED** — Probable uses `orderType: "FOK"`, Predict uses `strategy: "IOC"`.
13. Floating-point in buildOrder — Low risk for current position sizes (max $500). The two-step `Math.round(size * 1e8)` approach stays within 53-bit precision up to ~$90M. Deferred.
14. Max uint256 approvals — Standard DeFi practice. Risk accepted for now. Could add per-trade approval amounts later.
15. ~~Asymmetric price derivation~~ **DOCUMENTED** — Comment added to Predict provider explaining complement-based NO pricing vs Probable's ask-only pricing. Phantom spread risk noted.
16. No metrics/alerting — Deferred to post-launch. Operator must watch logs.

---

Remaining: Test Coverage Gaps

The test suite (123 tests, all passing) covers utility functions well but has zero coverage of CLOB execution paths:

| Path                                        | Tests   |
|---------------------------------------------|---------|
| executeClob() — full order flow             | 0       |
| pollForFills() — fill detection + timeout   | 0       |
| attemptUnwind() — partial fill recovery     | 0       |
| closeResolvedClob() — CTF redemption        | 0       |
| ProbableClobClient.placeOrder()             | 0       |
| PredictClobClient.placeOrder()              | 0       |
| Auth flows (L1/L2, JWT)                     | 0       |
| Nonce management across restart             | 0       |
| buildOrder() / serializeOrder()             | Covered |
| detectArbitrage()                           | Covered |
| Persistence round-trip                      | Covered |
| Jaccard / title matching                    | Covered |

---

Recommended Testing Before Live

Integration tests (testnet):
- Auth → place order → cancel → verify cancelled
- Place two legs → poll → both fill → position FILLED
- Place two legs → one fills, one expires → partial fill → unwind placed → auto-unpause
- Kill process mid-order → restart → verify no duplicate orders (nonce persisted immediately)
- Let JWT expire during polling → verify re-auth works (max 1 retry, no infinite recursion)
- Verify token ID mapping: fetch Probable market, confirm YES/NO token order matches explicit tokens array
- Verify Predict orderbook sort order (asks ascending, bids descending)
- Confirm fee calculations: Predict 200bps, Probable 175bps in arbitrage detection
- Place 1 USDT arb on testnet end-to-end, verify both legs fill (FOK/IOC) and profit is correct

Manual verification:
- Run list-matches.ts — spot-check 20 template matches are correct pairs
- Compare Probable ask-only price vs Predict bid-complement price for same market
- Trigger graceful shutdown during active scan — verify orders cancelled, state saved, 30s timeout works
- Trigger SIGTERM while provider is slow — verify scan timeout (120s) kicks in
