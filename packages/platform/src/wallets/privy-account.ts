import { toAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { privyClient, authorizationContext } from "../auth/privy.js";

function convertBigInts(obj: unknown): unknown {
  if (typeof obj === "bigint") {
    // Use Number for values that fit safely, hex string for large values
    if (obj <= BigInt(Number.MAX_SAFE_INTEGER) && obj >= BigInt(-Number.MAX_SAFE_INTEGER)) {
      return Number(obj);
    }
    return `0x${obj.toString(16)}`;
  }
  if (Array.isArray(obj)) return obj.map(convertBigInts);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = convertBigInts(v);
    }
    return result;
  }
  return obj;
}

export function createPrivyAccount(walletId: string, address: Address) {
  return toAccount({
    address,
    async signMessage({ message }) {
      let msg: string | Uint8Array;
      if (typeof message === "string") {
        msg = message;
      } else if (typeof message === "object" && "raw" in message) {
        msg = message.raw instanceof Uint8Array ? message.raw : message.raw;
      } else {
        msg = String(message);
      }

      const result = await privyClient.wallets().ethereum().signMessage(walletId, {
        message: msg,
        authorization_context: authorizationContext,
      });
      return result.signature as Hex;
    },

    async signTypedData({ domain, types, primaryType, message }) {
      const privyTypes: Record<string, Array<{ name: string; type: string }>> = {};
      if (types) {
        for (const [key, fields] of Object.entries(types as Record<string, Array<{ name: string; type: string }>>)) {
          if (key === "EIP712Domain") continue;
          privyTypes[key] = fields.map((f) => ({ name: f.name, type: f.type }));
        }
      }

      const result = await privyClient.wallets().ethereum().signTypedData(walletId, {
        params: {
          typed_data: {
            domain: convertBigInts(domain ?? {}) as Record<string, unknown>,
            types: privyTypes,
            primary_type: primaryType,
            message: convertBigInts(message ?? {}) as Record<string, unknown>,
          },
        },
        authorization_context: authorizationContext,
      });
      return result.signature as Hex;
    },

    async signTransaction(tx) {
      const transaction: Record<string, unknown> = {};
      if (tx.to) transaction.to = tx.to;
      if (tx.value !== undefined) transaction.value = `0x${tx.value.toString(16)}`;
      if (tx.data) transaction.data = tx.data;
      if (tx.nonce !== undefined) transaction.nonce = tx.nonce;
      if (tx.gas !== undefined) transaction.gas_limit = `0x${tx.gas.toString(16)}`;
      if (tx.chainId !== undefined) transaction.chain_id = tx.chainId;
      if (tx.maxFeePerGas !== undefined)
        transaction.max_fee_per_gas = `0x${tx.maxFeePerGas.toString(16)}`;
      if (tx.maxPriorityFeePerGas !== undefined)
        transaction.max_priority_fee_per_gas = `0x${tx.maxPriorityFeePerGas.toString(16)}`;
      if (tx.gasPrice !== undefined)
        transaction.gas_price = `0x${tx.gasPrice.toString(16)}`;

      const result = await privyClient.wallets().ethereum().signTransaction(walletId, {
        params: {
          transaction: transaction as any,
        },
        authorization_context: authorizationContext,
      });
      return result.signed_transaction as Hex;
    },
  });
}
