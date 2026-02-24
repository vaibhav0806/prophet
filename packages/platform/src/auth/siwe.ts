import { generateNonce, SiweMessage } from "siwe";
import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET_KEY = new TextEncoder().encode(
  process.env.JWT_SECRET || "prophit-dev-secret-change-in-production",
);
const JWT_ISSUER = "prophit-platform";
const JWT_EXPIRATION = "24h";

// In-memory nonce store (use DB in production)
const pendingNonces = new Map<string, { nonce: string; createdAt: number }>();
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function createNonce(): string {
  const nonce = generateNonce();
  // Clean expired nonces
  const now = Date.now();
  for (const [key, val] of pendingNonces) {
    if (now - val.createdAt > NONCE_TTL_MS) pendingNonces.delete(key);
  }
  pendingNonces.set(nonce, { nonce, createdAt: now });
  return nonce;
}

export async function verifySiweMessage(
  message: string,
  signature: string,
): Promise<{ address: string }> {
  const siweMessage = new SiweMessage(message);
  const { data } = await siweMessage.verify({ signature });

  // Verify nonce was issued by us
  if (!pendingNonces.has(data.nonce)) {
    throw new Error("Invalid or expired nonce");
  }
  pendingNonces.delete(data.nonce);

  return { address: data.address };
}

export async function createSessionToken(
  userId: string,
  walletAddress: string,
): Promise<string> {
  return new SignJWT({ userId, walletAddress })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setExpirationTime(JWT_EXPIRATION)
    .sign(JWT_SECRET_KEY);
}

export async function verifySessionToken(
  token: string,
): Promise<{ userId: string; walletAddress: string }> {
  const { payload } = await jwtVerify(token, JWT_SECRET_KEY, {
    issuer: JWT_ISSUER,
  });
  return {
    userId: payload.userId as string,
    walletAddress: payload.walletAddress as string,
  };
}
