import { Hono } from "hono";
import type { Database } from "@prophit/shared/db";
import { tradingWallets, withdrawals, deposits } from "@prophit/shared/db";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import type { KeyVault } from "../../wallets/key-vault.js";
import type { DepositWatcher } from "../../wallets/deposit-watcher.js";
import type { WithdrawalProcessor } from "../../wallets/withdrawal.js";
import type { AuthEnv } from "../server.js";

// Daily withdrawal limit in USDT base units (6 decimals: 1000 * 1e6)
const DAILY_WITHDRAWAL_LIMIT = 1_000_000_000n;

// BNB/USDT conversion for daily limit calculation (conservative estimate)
const BNB_USDT_ESTIMATE = 600n;

export function createWalletRoutes(params: {
  db: Database;
  keyVault: KeyVault;
  depositWatcher: DepositWatcher;
  withdrawalProcessor: WithdrawalProcessor;
}): Hono<AuthEnv> {
  const { db, keyVault, depositWatcher, withdrawalProcessor } = params;
  const app = new Hono<AuthEnv>();

  // GET /api/wallet - Get user's deposit address and balances
  app.get("/", async (c) => {
    const userId = c.get("userId") as string;

    // Get or create trading wallet
    let [wallet] = await db.select().from(tradingWallets).where(eq(tradingWallets.userId, userId)).limit(1);

    if (!wallet) {
      // Auto-create wallet for new users
      await keyVault.createWalletForUser(userId);
      [wallet] = await db.select().from(tradingWallets).where(eq(tradingWallets.userId, userId)).limit(1);
    }

    // Get live balances
    const balances = await depositWatcher.getBalances(wallet.address);

    // Get deposit history
    const userDeposits = await db.select().from(deposits)
      .where(eq(deposits.userId, userId))
      .orderBy(desc(deposits.confirmedAt))
      .limit(20);

    return c.json({
      address: wallet.address,
      usdtBalance: balances.usdtBalance.toString(),
      bnbBalance: balances.bnbBalance.toString(),
      deposits: userDeposits.map(d => ({
        id: d.id,
        token: d.token,
        amount: d.amount.toString(),
        confirmedAt: d.confirmedAt.toISOString(),
      })),
    });
  });

  // POST /api/wallet/withdraw - Request a withdrawal
  app.post("/withdraw", async (c) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json<{ token: string; amount: string; toAddress: string }>();

    // --- Input validation ---

    if (!body.token || !body.amount || !body.toAddress) {
      return c.json({ error: "Missing token, amount, or toAddress" }, 400);
    }

    if (!["USDT", "BNB"].includes(body.token)) {
      return c.json({ error: "Invalid token. Must be USDT or BNB" }, 400);
    }

    if (!/^0x[0-9a-fA-F]{40}$/.test(body.toAddress)) {
      return c.json({ error: "Invalid to address" }, 400);
    }

    // Validate amount is a positive integer string (no decimals — amounts are in base units)
    if (!/^\d+$/.test(body.amount)) {
      return c.json({ error: "Amount must be a positive integer string" }, 400);
    }

    const amount = BigInt(body.amount);
    if (amount <= 0n) {
      return c.json({ error: "Amount must be positive" }, 400);
    }

    // --- Balance check ---

    const [wallet] = await db.select().from(tradingWallets).where(eq(tradingWallets.userId, userId)).limit(1);
    if (!wallet) {
      return c.json({ error: "No wallet found" }, 400);
    }

    const balances = await depositWatcher.getBalances(wallet.address);
    const available = body.token === "USDT" ? balances.usdtBalance : balances.bnbBalance;

    if (amount > available) {
      return c.json({ error: "Insufficient balance" }, 400);
    }

    // --- Daily withdrawal limit (1000 USDT equivalent) ---

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const todayWithdrawals = await db
      .select({
        token: withdrawals.token,
        total: sql<string>`COALESCE(SUM(${withdrawals.amount}), 0)`,
      })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.userId, userId),
          gte(withdrawals.createdAt, todayStart),
        ),
      )
      .groupBy(withdrawals.token);

    let todayUsdtEquivalent = 0n;
    for (const row of todayWithdrawals) {
      const total = BigInt(row.total);
      if (row.token === "USDT") {
        todayUsdtEquivalent += total;
      } else if (row.token === "BNB") {
        // Convert BNB to USDT equivalent (BNB has 18 decimals, USDT has 6)
        todayUsdtEquivalent += (total * BNB_USDT_ESTIMATE) / 10n ** 12n;
      }
    }

    // Convert current request to USDT equivalent
    let requestUsdtEquivalent = amount;
    if (body.token === "BNB") {
      requestUsdtEquivalent = (amount * BNB_USDT_ESTIMATE) / 10n ** 12n;
    }

    if (todayUsdtEquivalent + requestUsdtEquivalent > DAILY_WITHDRAWAL_LIMIT) {
      return c.json({
        error: "Daily withdrawal limit exceeded (1000 USDT equivalent per day)",
      }, 400);
    }

    // --- Create withdrawal ---

    const withdrawalId = crypto.randomUUID();
    await db.insert(withdrawals).values({
      id: withdrawalId,
      userId,
      toAddress: body.toAddress.toLowerCase(),
      token: body.token,
      amount,
      status: "pending",
    });

    // Process immediately (could be queued in production)
    try {
      const result = await withdrawalProcessor.processWithdrawal(withdrawalId);
      return c.json({ id: withdrawalId, status: "confirmed", txHash: result.txHash });
    } catch (err) {
      return c.json({ id: withdrawalId, status: "failed", error: String(err) }, 500);
    }
  });

  return app;
}
