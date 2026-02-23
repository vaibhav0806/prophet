import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function requireAddress(name: string): `0x${string}` {
  const value = requireEnv(name);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Invalid address for ${name}: ${value}`);
  }
  return value as `0x${string}`;
}

function requireHex(name: string): `0x${string}` {
  const value = requireEnv(name);
  if (!value.startsWith("0x")) {
    throw new Error(`Invalid hex for ${name}: ${value}`);
  }
  return value as `0x${string}`;
}

export const config = {
  rpcUrl: requireEnv("RPC_URL"),
  privateKey: requireHex("PRIVATE_KEY") as `0x${string}`,
  vaultAddress: requireAddress("VAULT_ADDRESS"),
  adapterAAddress: requireAddress("ADAPTER_A_ADDRESS"),
  adapterBAddress: requireAddress("ADAPTER_B_ADDRESS"),
  usdtAddress: requireAddress("USDT_ADDRESS"),
  marketId: requireHex("MARKET_ID") as `0x${string}`,
  minSpreadBps: Number(process.env.MIN_SPREAD_BPS ?? "100"),
  maxPositionSize: BigInt(process.env.MAX_POSITION_SIZE ?? "500000000000000000000"),
  scanIntervalMs: Number(process.env.SCAN_INTERVAL_MS ?? "5000"),
  port: Number(process.env.PORT ?? "3001"),
} as const;

export type Config = typeof config;
