import type { WalletClient } from "viem";
import {
  type ClobOrder,
  type SignedClobOrder,
  ORDER_EIP712_DOMAIN,
  ORDER_EIP712_TYPES,
  CLOB_AUTH_EIP712_DOMAIN,
  CLOB_AUTH_EIP712_TYPES,
  SIDE_BUY,
  SIG_TYPE_EOA,
  ZERO_ADDRESS,
} from "./types.js";

/**
 * Build a ClobOrder from human-readable params.
 *
 * Price/size follow Polymarket convention:
 *   BUY side:  makerAmount = size (USDT you pay), takerAmount = size / price (shares you get)
 *   SELL side: makerAmount = size / price (shares you sell), takerAmount = size (USDT you get)
 *
 * All amounts are in raw units (6 decimals for USDT, but CTF uses 1e6 scaling).
 */
export function buildOrder(params: {
  maker: `0x${string}`;
  signer: `0x${string}`;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number; // USDT amount
  feeRateBps: number;
  expirationSec: number;
  nonce: bigint;
}): ClobOrder {
  const { maker, signer, tokenId, side, price, size, feeRateBps, expirationSec, nonce } = params;

  // CTF CLOB uses 1e6 scaling for amounts
  const SCALE = 1_000_000;
  const sizeRaw = BigInt(Math.floor(size * SCALE));
  const sharesRaw = BigInt(Math.floor((size / price) * SCALE));

  const isBuy = side === "BUY";

  return {
    salt: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
    maker,
    signer,
    taker: ZERO_ADDRESS,
    tokenId: BigInt(tokenId),
    makerAmount: isBuy ? sizeRaw : sharesRaw,
    takerAmount: isBuy ? sharesRaw : sizeRaw,
    expiration: BigInt(Math.floor(Date.now() / 1000) + expirationSec),
    nonce,
    feeRateBps: BigInt(feeRateBps),
    side: isBuy ? SIDE_BUY : 1,
    signatureType: SIG_TYPE_EOA,
  };
}

/**
 * Sign a ClobOrder using EIP-712 typed data via viem WalletClient.
 */
export async function signOrder(
  walletClient: WalletClient,
  order: ClobOrder,
  chainId: number,
  exchangeAddress: `0x${string}`,
): Promise<SignedClobOrder> {
  const account = walletClient.account;
  if (!account) throw new Error("WalletClient has no account");

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      ...ORDER_EIP712_DOMAIN,
      chainId,
      verifyingContract: exchangeAddress,
    },
    types: ORDER_EIP712_TYPES,
    primaryType: "Order",
    message: {
      salt: order.salt,
      maker: order.maker,
      signer: order.signer,
      taker: order.taker,
      tokenId: order.tokenId,
      makerAmount: order.makerAmount,
      takerAmount: order.takerAmount,
      expiration: order.expiration,
      nonce: order.nonce,
      feeRateBps: order.feeRateBps,
      side: order.side,
      signatureType: order.signatureType,
    },
  });

  return { order, signature };
}

/**
 * Sign a ClobAuth message for Polymarket-style API auth (POLY_* headers).
 * Returns the signature and the timestamp/nonce used.
 */
export async function signClobAuth(
  walletClient: WalletClient,
  chainId: number,
): Promise<{ signature: `0x${string}`; timestamp: string; nonce: bigint; address: `0x${string}` }> {
  const account = walletClient.account;
  if (!account) throw new Error("WalletClient has no account");

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = 0n;
  const address = account.address;

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      ...CLOB_AUTH_EIP712_DOMAIN,
      chainId,
    },
    types: CLOB_AUTH_EIP712_TYPES,
    primaryType: "ClobAuth",
    message: {
      address,
      timestamp,
      nonce,
      message: "This message attests that I control the given wallet",
    },
  });

  return { signature, timestamp, nonce, address };
}

/**
 * Serialize a ClobOrder to JSON-friendly format (all bigints → strings).
 */
export function serializeOrder(order: ClobOrder): Record<string, string | number> {
  return {
    salt: order.salt.toString(),
    maker: order.maker,
    signer: order.signer,
    taker: order.taker,
    tokenId: order.tokenId.toString(),
    makerAmount: order.makerAmount.toString(),
    takerAmount: order.takerAmount.toString(),
    expiration: order.expiration.toString(),
    nonce: order.nonce.toString(),
    feeRateBps: order.feeRateBps.toString(),
    side: order.side,
    signatureType: order.signatureType,
  };
}
