import { Hono } from "hono";
import { createNonce, verifySiweMessage, createSessionToken } from "../../auth/siwe.js";
import type { Database } from "@prophit/shared/db";
import { users } from "@prophit/shared/db";
import { eq } from "drizzle-orm";

export function createAuthRoutes(db: Database): Hono {
  const app = new Hono();

  // POST /api/auth/nonce - Get a SIWE nonce
  app.post("/nonce", (c) => {
    const nonce = createNonce();
    return c.json({ nonce });
  });

  // POST /api/auth/verify - Verify SIWE signature and create session
  app.post("/verify", async (c) => {
    const body = await c.req.json<{ message: string; signature: string }>();

    if (!body.message || !body.signature) {
      return c.json({ error: "Missing message or signature" }, 400);
    }

    try {
      const { address } = await verifySiweMessage(body.message, body.signature);
      const normalizedAddress = address.toLowerCase();

      // Find or create user
      let [user] = await db
        .select()
        .from(users)
        .where(eq(users.walletAddress, normalizedAddress))
        .limit(1);

      if (!user) {
        const id = crypto.randomUUID();
        [user] = await db
          .insert(users)
          .values({
            id,
            walletAddress: normalizedAddress,
          })
          .returning();
      } else {
        // Update last login
        await db
          .update(users)
          .set({ lastLoginAt: new Date() })
          .where(eq(users.id, user.id));
      }

      const token = await createSessionToken(user.id, normalizedAddress);
      return c.json({ token, userId: user.id, address: normalizedAddress });
    } catch (err) {
      return c.json({ error: "Verification failed: " + String(err) }, 401);
    }
  });

  // POST /api/auth/logout - No-op for JWT (client discards token)
  app.post("/logout", (c) => {
    return c.json({ ok: true });
  });

  return app;
}
