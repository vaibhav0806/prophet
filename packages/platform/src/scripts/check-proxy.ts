import "dotenv/config";
import { createPublicClient, http, defineChain } from "viem";

const rpcUrl = process.env.RPC_URL!;
const chain = defineChain({
  id: 56,
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});

const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 30_000 }) });

const FACTORY = "0xB99159aBF0bF59a512970586F38292f8b9029924";
const ABI = [{
  inputs: [{ internalType: "address", name: "user", type: "address" }],
  name: "computeProxyAddress",
  outputs: [{ internalType: "address", name: "", type: "address" }],
  stateMutability: "view",
  type: "function",
}] as const;

const eoa = "0xdad013d95acb067b2431fde18cbac2bc92ef6b6c";

const proxy = await publicClient.readContract({
  address: FACTORY,
  abi: ABI,
  functionName: "computeProxyAddress",
  args: [eoa as `0x${string}`],
});
console.log("Computed proxy:", proxy);

const code = await publicClient.getBytecode({ address: proxy });
console.log("Bytecode at proxy:", code ? `${code.length} chars` : "none");

// Also check the EOA balance
const balance = await publicClient.getBalance({ address: eoa as `0x${string}` });
console.log("EOA BNB balance:", Number(balance) / 1e18);

// Check recent txs via getTransactionCount
const nonce = await publicClient.getTransactionCount({ address: eoa as `0x${string}` });
console.log("EOA nonce:", nonce);

// Check USDT balances
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const balOfAbi = [{ inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" }] as const;

const eoaUsdt = await publicClient.readContract({ address: USDT, abi: balOfAbi, functionName: "balanceOf", args: [eoa as `0x${string}`] });
const safeUsdt = await publicClient.readContract({ address: USDT, abi: balOfAbi, functionName: "balanceOf", args: [proxy] });
console.log("\nEOA USDT:", Number(eoaUsdt) / 1e18);
console.log("Safe USDT:", Number(safeUsdt) / 1e18);
console.log("Total USDT:", (Number(eoaUsdt) + Number(safeUsdt)) / 1e18);

process.exit(0);
