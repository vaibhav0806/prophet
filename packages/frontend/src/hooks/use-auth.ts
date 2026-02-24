"use client";

import { useAccount, useSignMessage } from "wagmi";
import { useRequestNonce, useVerifySignature, setSession } from "./use-platform-api";
import { SiweMessage } from "siwe";

export function useAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const requestNonce = useRequestNonce();
  const verifySignature = useVerifySignature();

  const signIn = async (): Promise<{ userId: string; address: string }> => {
    if (!address) throw new Error("Wallet not connected");

    // 1. Get nonce
    const { nonce } = await requestNonce.mutateAsync();

    // 2. Create SIWE message
    const message = new SiweMessage({
      domain: window.location.host,
      address,
      statement: "Sign in to Prophit",
      uri: window.location.origin,
      version: "1",
      chainId: 56, // BSC
      nonce,
    });

    const messageString = message.prepareMessage();

    // 3. Sign
    const signature = await signMessageAsync({ message: messageString });

    // 4. Verify and get token
    const result = await verifySignature.mutateAsync({
      message: messageString,
      signature,
    });

    // 5. Store session
    setSession(result.token);

    return { userId: result.userId, address: result.address };
  };

  return {
    signIn,
    isConnected,
    address,
    isLoading: requestNonce.isPending || verifySignature.isPending,
  };
}
