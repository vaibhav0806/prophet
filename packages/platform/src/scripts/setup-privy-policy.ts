/**
 * One-time setup script: adds policy rules and assigns policy to user wallet.
 *
 * Usage: pnpm --filter platform exec tsx src/scripts/setup-privy-policy.ts <privy-user-id>
 * Example: pnpm --filter platform exec tsx src/scripts/setup-privy-policy.ts did:privy:cmm11oxdw003i0cia1qc8yul8
 */
import "dotenv/config";
import { privyClient, authorizationContext } from "../auth/privy.js";
import { isEmbeddedWalletLinkedAccount } from "@privy-io/node";

const POLICY_ID = "l9i6smht7zmc9zn0x38izidi";

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error("Usage: tsx src/scripts/setup-privy-policy.ts <privy-user-id>");
    process.exit(1);
  }

  if (!authorizationContext) {
    console.error("PRIVY_AUTHORIZATION_KEY not set in .env");
    process.exit(1);
  }

  // Step 1: Add allow-all rule to policy
  console.log(`[1/3] Adding allow-all rule to policy ${POLICY_ID}...`);
  try {
    const rule = await privyClient.policies().createRule(POLICY_ID, {
      authorization_context: authorizationContext,
      name: "allow-all-signing",
      method: "*",
      action: "ALLOW",
      conditions: [],
    });
    console.log(`  Rule created:`, JSON.stringify(rule, null, 2));
  } catch (err) {
    console.error(`  Failed to create rule:`, err);
    process.exit(1);
  }

  // Step 2: Get user's embedded wallet ID
  console.log(`[2/3] Fetching wallet for user ${userId}...`);
  const user = await privyClient.users()._get(userId);
  const embeddedWallet = user.linked_accounts.find(
    (a) => isEmbeddedWalletLinkedAccount(a) && a.chain_type === "ethereum",
  );
  if (!embeddedWallet || embeddedWallet.type !== "wallet") {
    console.error(`  No embedded Ethereum wallet found for user`);
    process.exit(1);
  }
  console.log(`  Wallet ID: ${embeddedWallet.id}, Address: ${embeddedWallet.address}`);

  // Step 3: Assign policy to wallet
  console.log(`[3/3] Assigning policy to wallet...`);
  try {
    const wallet = await privyClient.wallets().update(embeddedWallet.id, {
      authorization_context: authorizationContext,
      policy_ids: [POLICY_ID],
    });
    console.log(`  Wallet updated:`, JSON.stringify(wallet, null, 2));
  } catch (err) {
    console.error(`  Failed to assign policy:`, err);
    process.exit(1);
  }

  console.log("\nDone! Policy assigned. Restart the platform and try again.");
}

main().catch(console.error);
