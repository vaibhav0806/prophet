import {
  type PublicClient,
  type WalletClient,
  type Chain,
  type Address,
} from "viem";

const PROXY_WALLET_FACTORY_ADDRESS = "0xB99159aBF0bF59a512970586F38292f8b9029924" as const;

const PROXY_WALLET_FACTORY_ABI = [
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "computeProxyAddress",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "paymentToken", type: "address" },
      { internalType: "uint256", name: "payment", type: "uint256" },
      { internalType: "address payable", name: "paymentReceiver", type: "address" },
      {
        components: [
          { internalType: "uint8", name: "v", type: "uint8" },
          { internalType: "bytes32", name: "r", type: "bytes32" },
          { internalType: "bytes32", name: "s", type: "bytes32" },
        ],
        internalType: "struct SafeProxyFactory.Sig",
        name: "createSig",
        type: "tuple",
      },
    ],
    name: "createProxy",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const EIP712_DOMAIN = {
  name: "Probable Contract Proxy Factory",
  chainId: 56n,
  verifyingContract: PROXY_WALLET_FACTORY_ADDRESS as `0x${string}`,
} as const;

const CREATE_PROXY_TYPES = {
  CreateProxy: [
    { name: "paymentToken", type: "address" },
    { name: "payment", type: "uint256" },
    { name: "paymentReceiver", type: "address" },
  ],
} as const;

/**
 * Get or create a proxy wallet via Probable's SafeProxyFactory.
 * The proxy address is deterministic from the EOA address.
 */
export async function getOrCreateProbableProxy(
  walletClient: WalletClient,
  publicClient: PublicClient,
  eoaAddress: Address,
  chain: Chain,
): Promise<Address> {
  // Compute deterministic proxy address
  const proxyAddress = await publicClient.readContract({
    address: PROXY_WALLET_FACTORY_ADDRESS,
    abi: PROXY_WALLET_FACTORY_ABI,
    functionName: "computeProxyAddress",
    args: [eoaAddress],
  });

  // Check if already deployed
  const code = await publicClient.getBytecode({ address: proxyAddress });
  if (code && code !== "0x" && code.length > 2) {
    console.log(`[SafeDeployer] Proxy wallet already exists: ${proxyAddress}`);
    return proxyAddress;
  }

  console.log(`[SafeDeployer] Creating new proxy wallet for ${eoaAddress}...`);

  // Sign EIP-712 typed data (no "user" field in the struct — contract recovers user from signature)
  const signature = await walletClient.signTypedData({
    account: walletClient.account!,
    domain: { ...EIP712_DOMAIN, chainId: BigInt(chain.id) },
    types: CREATE_PROXY_TYPES,
    primaryType: "CreateProxy",
    message: {
      paymentToken: ZERO_ADDRESS,
      payment: 0n,
      paymentReceiver: ZERO_ADDRESS,
    },
  });

  // Split signature into v, r, s
  const r = `0x${signature.slice(2, 66)}` as `0x${string}`;
  const s = `0x${signature.slice(66, 130)}` as `0x${string}`;
  const v = parseInt(signature.slice(130, 132), 16);

  // Call createProxy on the factory
  const txHash = await walletClient.writeContract({
    address: PROXY_WALLET_FACTORY_ADDRESS,
    abi: PROXY_WALLET_FACTORY_ABI,
    functionName: "createProxy",
    args: [ZERO_ADDRESS, 0n, ZERO_ADDRESS, { v, r, s }],
    chain,
    account: walletClient.account!,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== "success") {
    throw new Error(`Proxy wallet creation tx reverted: ${txHash}`);
  }

  // Verify creation (small delay for RPC propagation on BSC)
  await new Promise((r) => setTimeout(r, 2000));
  const newCode = await publicClient.getBytecode({ address: proxyAddress });
  if (!newCode || newCode === "0x" || newCode.length <= 2) {
    throw new Error(`Failed to create proxy wallet — no bytecode at ${proxyAddress} (tx: ${txHash})`);
  }

  console.log(`[SafeDeployer] Proxy wallet created at ${proxyAddress}`);
  return proxyAddress;
}
