import type { Context, Next } from "hono";
import { verifyPrivyToken } from "./privy.js";

export interface AuthContext {
  userId: string;
  walletAddress: string;
}

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  try {
    const session = await verifyPrivyToken(token);
    c.set("userId", session.userId);
    c.set("walletAddress", session.walletAddress);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired session" }, 401);
  }
}
