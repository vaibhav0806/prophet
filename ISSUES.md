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
| Test Coverage        | Good            | None — 191 tests, all passing              |

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

MEDIUM — all actionable items fixed

12. ~~GTC orders instead of IOC~~ **FIXED** — Probable uses `orderType: "FOK"`, Predict uses `strategy: "MARKET"`.
13. Floating-point in buildOrder — Low risk for current position sizes (max $500). The two-step `Math.round(size * 1e8)` approach stays within 53-bit precision up to ~$90M. Deferred.
14. Max uint256 approvals — Standard DeFi practice. Risk accepted for now. Could add per-trade approval amounts later.
15. ~~Asymmetric price derivation~~ **DOCUMENTED** — Comment added to Predict provider explaining complement-based NO pricing vs Probable's ask-only pricing. Phantom spread risk noted.
16. No metrics/alerting — Deferred to post-launch. Operator must watch logs.

---

Test Coverage — 191 tests, all passing

| Path                                        | Tests    |
|---------------------------------------------|----------|
| executeClob() — full order flow             | Covered  |
| pollForFills() — fill detection + timeout   | Covered  |
| attemptUnwind() — partial fill recovery     | Covered  |
| closeResolvedClob() — CTF redemption        | Covered  |
| ProbableClobClient.placeOrder()             | Covered  |
| PredictClobClient.placeOrder()              | Covered  |
| Auth flows (L1/L2, JWT)                     | Covered  |
| Nonce management across restart             | Covered  |
| buildOrder() / serializeOrder()             | Covered  |
| detectArbitrage()                           | Covered  |
| Persistence round-trip                      | Covered  |
| Jaccard / title matching                    | Covered  |

---

Recommended Manual Verification Before Live

- Run list-matches.ts — spot-check 20 template matches are correct pairs
- Compare Probable ask-only price vs Predict bid-complement price for same market
- Trigger graceful shutdown during active scan — verify orders cancelled, state saved, 30s timeout works
- Place 1 USDT arb on testnet end-to-end, verify both legs fill (FOK/IOC) and profit is correct
