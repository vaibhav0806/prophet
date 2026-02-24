import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { privateKeyToAccount } from "viem/accounts";

// BIP-44 path for BSC (same as Ethereum): m/44'/60'/0'/0/{index}
const HD_PATH_PREFIX = "m/44'/60'/0'/0";

export interface DerivedWallet {
  address: `0x${string}`;
  privateKey: `0x${string}`;
  derivationIndex: number;
}

/**
 * Derive a wallet from the platform's HD master seed at a specific index.
 * Each user gets a unique index, ensuring deterministic, non-overlapping addresses.
 */
export function deriveWallet(masterSeed: Uint8Array, index: number): DerivedWallet {
  const hdKey = HDKey.fromMasterSeed(masterSeed);
  const child = hdKey.derive(`${HD_PATH_PREFIX}/${index}`);

  if (!child.privateKey) {
    throw new Error(`Failed to derive private key at index ${index}`);
  }

  const privateKey = `0x${Buffer.from(child.privateKey).toString("hex")}` as `0x${string}`;
  const account = privateKeyToAccount(privateKey);

  return {
    address: account.address,
    privateKey,
    derivationIndex: index,
  };
}

/**
 * Create master seed from a BIP-39 mnemonic phrase.
 */
export function seedFromMnemonic(mnemonic: string): Uint8Array {
  return mnemonicToSeedSync(mnemonic);
}

/**
 * Create master seed from a hex seed string (for non-mnemonic setups).
 */
export function seedFromHex(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex.replace(/^0x/, ""), "hex"));
}
