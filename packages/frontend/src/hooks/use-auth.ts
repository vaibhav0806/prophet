"use client";

import { useEffect, useRef } from "react";
import { usePrivy, useWallets, useSessionSigners, getAccessToken } from "@privy-io/react-auth";
import { setAccessTokenGetter, setAuthenticated } from "./use-platform-api";

const KEY_QUORUM_ID = "p9d4d3lh4zdrubx15wyikodf";
const POLICY_ID = "l9i6smht7zmc9zn0x38izidi";

export function useAuth() {
  const { login, logout, authenticated, user, ready } = usePrivy();
  const { wallets } = useWallets();
  const { addSessionSigners } = useSessionSigners();
  const delegatedRef = useRef<string | null>(null);

  const embeddedWallet = wallets.find(w => w.walletClientType === "privy");
  const address = embeddedWallet?.address || user?.wallet?.address;

  // Keep platform API layer in sync with Privy auth state
  useEffect(() => {
    setAuthenticated(authenticated);
    if (authenticated) {
      setAccessTokenGetter(() => getAccessToken());
    } else {
      setAccessTokenGetter(null);
    }
  }, [authenticated]);

  // Register server key quorum as session signer for server-side signing
  useEffect(() => {
    if (!authenticated || !embeddedWallet) return;
    if (delegatedRef.current === embeddedWallet.address) return;
    delegatedRef.current = embeddedWallet.address;
    addSessionSigners({
      address: embeddedWallet.address,
      signers: [{ signerId: KEY_QUORUM_ID, policyIds: [POLICY_ID] }],
    }).catch((err) => {
      // "Duplicate signer" means it's already registered — safe to ignore
      if (String(err).includes("Duplicate")) return;
      console.warn("[useAuth] Failed to add session signer:", err);
      delegatedRef.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, embeddedWallet?.address]);

  return {
    login,
    logout,
    isAuthenticated: authenticated,
    isReady: ready,
    address: address as `0x${string}` | undefined,
    user,
    getAccessToken,
  };
}
