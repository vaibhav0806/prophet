import { privyClient } from "../auth/privy.js";
import { isEmbeddedWalletLinkedAccount } from "@privy-io/node";

export async function getOrCreateWallet(
  privyUserId: string,
): Promise<{ address: string; walletId: string }> {
  const user = await privyClient.users()._get(privyUserId);
  const embeddedWallet = user.linked_accounts.find(
    (a) => isEmbeddedWalletLinkedAccount(a) && a.chain_type === "ethereum",
  );

  if (!embeddedWallet || !isEmbeddedWalletLinkedAccount(embeddedWallet)) {
    throw new Error("No embedded Ethereum wallet found for user");
  }

  if (!embeddedWallet.id) {
    throw new Error("Embedded wallet has no ID (cannot use for delegated signing)");
  }

  return { address: embeddedWallet.address, walletId: embeddedWallet.id };
}

export async function getWalletAddress(privyUserId: string): Promise<string> {
  const { address } = await getOrCreateWallet(privyUserId);
  return address;
}
