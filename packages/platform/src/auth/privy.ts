import { PrivyClient, isEmbeddedWalletLinkedAccount, type AuthorizationContext } from "@privy-io/node";

const appId = process.env.PRIVY_APP_ID ?? "cmm0zisg200l80bl8biqwbrwx";
const appSecret =
  process.env.PRIVY_APP_SECRET ??
  "privy_app_secret_5qEtJMpVY37FoGeiTPfgdx2vrFEAEauUuamXwjf3Zj1A6gzAdj4DMBeW84SB2SzEC9WvqNTtFGCvYRPvPLU6bCH";

export const privyClient = new PrivyClient({ appId, appSecret });

// Authorization context for delegated wallet actions.
// The key is a base64-encoded PKCS8 P-256 private key (no PEM headers).
// Generated in Privy dashboard: Embedded wallets > Advanced > Delegated actions.
const authorizationKey = process.env.PRIVY_AUTHORIZATION_KEY;
export const authorizationContext: AuthorizationContext | undefined = authorizationKey
  ? { authorization_private_keys: [authorizationKey] }
  : undefined;

export async function verifyPrivyToken(
  accessToken: string,
): Promise<{ userId: string; walletAddress: string }> {
  const claims = await privyClient.utils().auth().verifyAccessToken(accessToken);
  const userId = claims.user_id; // e.g. "did:privy:xxx"

  // Fetch user to get linked wallets
  const user = await privyClient.users()._get(userId);
  const embeddedWallet = user.linked_accounts.find(
    (a) => isEmbeddedWalletLinkedAccount(a) && a.chain_type === "ethereum",
  );

  if (!embeddedWallet || embeddedWallet.type !== "wallet") {
    throw new Error("No embedded Ethereum wallet found for user");
  }

  return { userId, walletAddress: embeddedWallet.address.toLowerCase() };
}
