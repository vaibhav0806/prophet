import { Hono } from "hono";
import type { Database } from "@prophit/shared/db";
import { userConfigs } from "@prophit/shared/db";
import { eq } from "drizzle-orm";
import type { AgentManager } from "../../agents/agent-manager.js";
import type { KeyVault } from "../../wallets/key-vault.js";
import type { AuthEnv } from "../server.js";

export function createAgentRoutes(params: {
  db: Database;
  agentManager: AgentManager;
  keyVault: KeyVault;
}): Hono<AuthEnv> {
  const { db, agentManager, keyVault } = params;
  const app = new Hono<AuthEnv>();

  // POST /api/agent/start - Start user's trading agent
  app.post("/start", async (c) => {
    const userId = c.get("userId") as string;

    // Get user config
    let [config] = await db.select().from(userConfigs).where(eq(userConfigs.userId, userId)).limit(1);

    if (!config) {
      // Create default config
      const configId = crypto.randomUUID();
      [config] = await db.insert(userConfigs).values({
        id: configId,
        userId,
      }).returning();
    }

    // Check if already running
    const existing = agentManager.getAgent(userId);
    if (existing?.isRunning()) {
      return c.json({ error: "Agent is already running" }, 409);
    }

    // Get private key
    const privateKey = await keyVault.getPrivateKey(userId);
    if (!privateKey) {
      return c.json({ error: "No trading wallet found. Please deposit first." }, 400);
    }

    // Create and start agent
    try {
      await agentManager.createAgent({
        userId,
        privateKey,
        config: {
          minTradeSize: config.minTradeSize,
          maxTradeSize: config.maxTradeSize,
          minSpreadBps: config.minSpreadBps,
          maxTotalTrades: config.maxTotalTrades,
          tradingDurationMs: config.tradingDurationMs,
          dailyLossLimit: config.dailyLossLimit,
          maxResolutionDays: config.maxResolutionDays,
        },
      });

      agentManager.startAgent(userId);

      // Update DB status
      await db.update(userConfigs)
        .set({ agentStatus: "running", tradingStartedAt: new Date(), updatedAt: new Date() })
        .where(eq(userConfigs.userId, userId));

      return c.json({ ok: true, status: "running" });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // POST /api/agent/stop - Stop user's trading agent
  app.post("/stop", async (c) => {
    const userId = c.get("userId") as string;

    agentManager.stopAgent(userId);
    agentManager.removeAgent(userId);

    await db.update(userConfigs)
      .set({ agentStatus: "stopped", updatedAt: new Date() })
      .where(eq(userConfigs.userId, userId));

    return c.json({ ok: true, status: "stopped" });
  });

  // GET /api/agent/status - Get agent running state
  app.get("/status", async (c) => {
    const userId = c.get("userId") as string;
    const agent = agentManager.getAgent(userId);

    if (!agent) {
      return c.json({ running: false, tradesExecuted: 0, pnl: 0, lastScan: 0, uptime: 0 });
    }

    const status = agent.getStatus();
    return c.json({
      running: status.running,
      tradesExecuted: status.tradesExecuted,
      lastScan: status.lastScan,
      uptime: status.uptime,
      config: status.config,
    });
  });

  return app;
}
