import type { PublicClient, WalletClient } from "viem";
import type {
  ClobClient,
  PlaceOrderParams,
  OrderResult,
  OrderSide,
  OrderStatusResult,
  OrderStatus,
} from "./types.js";
import { buildOrder, signOrder, serializeOrder } from "./signing.js";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";

const ERC1155_ABI = [
  {
    type: "function",
    name: "isApprovedForAll",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const ERC1155_SET_APPROVAL_ABI = [
  {
    type: "function",
    name: "setApprovalForAll",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

// Well-known BSC addresses for Predict.fun
const PREDICT_CTF_ADDRESS = "0xC5d01939Af7Ce9Ffc505F0bb36eFeDde7920f2dc" as `0x${string}`;
const BSC_USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`;

export class PredictClobClient implements ClobClient {
  readonly name = "Predict";
  readonly exchangeAddress: `0x${string}`;

  private walletClient: WalletClient;
  private apiBase: string;
  private apiKey: string;
  private chainId: number;
  private feeRateBps: number;
  private expirationSec: number;
  private dryRun: boolean;
  private nonce: bigint;
  private jwt: string | null;

  constructor(params: {
    walletClient: WalletClient;
    apiBase: string;
    apiKey: string;
    exchangeAddress: `0x${string}`;
    chainId: number;
    expirationSec?: number;
    dryRun?: boolean;
  }) {
    this.walletClient = params.walletClient;
    this.apiBase = params.apiBase.replace(/\/$/, "");
    this.apiKey = params.apiKey;
    this.exchangeAddress = params.exchangeAddress;
    this.chainId = params.chainId;
    this.feeRateBps = 200;
    this.expirationSec = params.expirationSec ?? 300;
    this.dryRun = params.dryRun ?? false;
    this.nonce = 0n;
    this.jwt = null;
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  async authenticate(): Promise<void> {
    const account = this.walletClient.account;
    if (!account) throw new Error("WalletClient has no account");

    // Step 1: GET auth message (nonce)
    const msgRes = await fetch(`${this.apiBase}/v1/auth/message`, {
      headers: { "x-api-key": this.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!msgRes.ok) {
      const body = await msgRes.text();
      throw new Error(`Predict auth/message failed (${msgRes.status}): ${body}`);
    }
    const msgData = (await msgRes.json()) as { success: boolean; data: { message: string } };
    const message = msgData.data.message;

    // Step 2: Sign the message
    const signature = await this.walletClient.signMessage({
      account,
      message,
    });

    // Step 3: POST login
    const loginRes = await fetch(`${this.apiBase}/v1/auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({ signer: account.address, message, signature }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!loginRes.ok) {
      const body = await loginRes.text();
      throw new Error(`Predict auth/login failed (${loginRes.status}): ${body}`);
    }
    const loginData = (await loginRes.json()) as { success?: boolean; data?: { token: string }; token?: string };
    this.jwt = loginData.data?.token ?? loginData.token ?? null;

    log.info("Predict JWT authenticated", { address: account.address });
  }

  private async ensureAuth(): Promise<string> {
    if (this.jwt) return this.jwt;
    await this.authenticate();
    if (!this.jwt) throw new Error("Predict authentication failed — no JWT");
    return this.jwt;
  }

  // ---------------------------------------------------------------------------
  // Nonce management
  // ---------------------------------------------------------------------------

  async fetchNonce(): Promise<bigint> {
    const jwt = await this.ensureAuth();
    const account = this.walletClient.account;
    if (!account) throw new Error("WalletClient has no account");

    const res = await fetch(
      `${this.apiBase}/v1/orders/nonce?address=${account.address}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
          "x-api-key": this.apiKey,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (res.status === 401) {
      this.jwt = null;
      return this.fetchNonce();
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Predict fetchNonce failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { nonce: string | number };
    this.nonce = BigInt(data.nonce);
    log.info("Predict nonce fetched", { nonce: this.nonce });
    return this.nonce;
  }

  // ---------------------------------------------------------------------------
  // ClobClient interface
  // ---------------------------------------------------------------------------

  async placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
    const account = this.walletClient.account;
    if (!account) throw new Error("WalletClient has no account");

    try {
      const jwt = await this.ensureAuth();

      const order = buildOrder({
        maker: account.address,
        signer: account.address,
        tokenId: params.tokenId,
        side: params.side,
        price: params.price,
        size: params.size,
        feeRateBps: this.feeRateBps,
        expirationSec: this.expirationSec,
        nonce: this.nonce,
      });

      const { signature } = await signOrder(
        this.walletClient,
        order,
        this.chainId,
        this.exchangeAddress,
      );

      const serialized = serializeOrder(order);

      const payload = {
        order: serialized,
        signature,
        owner: account.address,
      };

      if (this.dryRun) {
        log.info("Predict placeOrder dry-run", {
          tokenId: params.tokenId,
          side: params.side,
          price: params.price,
          size: params.size,
          payload: payload as unknown as Record<string, unknown>,
        });
        return { success: true, orderId: "dry-run", status: "dry-run" };
      }

      const res = await withRetry(
        () => this.postOrder(jwt, payload),
        { retries: 2, label: "Predict placeOrder" },
      );

      // Increment nonce after successful submission
      this.nonce += 1n;

      log.info("Predict order placed", {
        orderId: res.orderId,
        tokenId: params.tokenId,
        side: params.side,
        price: params.price,
        size: params.size,
      });

      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("Predict placeOrder failed", { error: msg });
      return { success: false, error: msg };
    }
  }

  private async postOrder(
    jwt: string,
    payload: { order: Record<string, string | number>; signature: `0x${string}`; owner: string },
  ): Promise<OrderResult> {
    const res = await fetch(`${this.apiBase}/v1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    // Re-auth on 401 and retry
    if (res.status === 401) {
      this.jwt = null;
      const newJwt = await this.ensureAuth();
      const retry = await fetch(`${this.apiBase}/v1/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${newJwt}`,
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (!retry.ok) {
        const body = await retry.text();
        throw new Error(`Predict POST /v1/orders failed after re-auth (${retry.status}): ${body}`);
      }
      const data = (await retry.json()) as { orderId?: string; status?: string };
      return { success: true, orderId: data.orderId, status: data.status };
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Predict POST /v1/orders failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as { orderId?: string; status?: string };
    return { success: true, orderId: data.orderId, status: data.status };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      const jwt = await this.ensureAuth();

      const body = JSON.stringify({ data: { ids: [orderId] } });

      const res = await fetch(`${this.apiBase}/v1/orders/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
          "x-api-key": this.apiKey,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 401) {
        this.jwt = null;
        const newJwt = await this.ensureAuth();
        const retry = await fetch(`${this.apiBase}/v1/orders/remove`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${newJwt}`,
            "x-api-key": this.apiKey,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!retry.ok) {
          log.error("Predict cancelOrder failed after re-auth", { orderId, status: retry.status });
          return false;
        }
        return true;
      }

      if (!res.ok) {
        log.error("Predict cancelOrder failed", { orderId, status: res.status });
        return false;
      }

      log.info("Predict order cancelled", { orderId });
      return true;
    } catch (err) {
      log.error("Predict cancelOrder error", { orderId, error: String(err) });
      return false;
    }
  }

  async getOpenOrders(): Promise<
    Array<{ orderId: string; tokenId: string; side: OrderSide; price: number; size: number }>
  > {
    try {
      const jwt = await this.ensureAuth();
      const account = this.walletClient.account;
      if (!account) throw new Error("WalletClient has no account");

      const res = await fetch(
        `${this.apiBase}/v1/orders?address=${account.address}&status=OPEN`,
        {
          headers: {
            Authorization: `Bearer ${jwt}`,
            "x-api-key": this.apiKey,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (res.status === 401) {
        this.jwt = null;
        return this.getOpenOrders();
      }

      if (!res.ok) {
        log.error("Predict getOpenOrders failed", { status: res.status });
        return [];
      }

      const data = (await res.json()) as Array<{
        orderId: string;
        tokenId: string;
        side: string;
        price: number | string;
        size: number | string;
      }>;

      return data.map((o) => ({
        orderId: o.orderId,
        tokenId: o.tokenId,
        side: (o.side === "BUY" ? "BUY" : "SELL") as OrderSide,
        price: Number(o.price),
        size: Number(o.size),
      }));
    } catch (err) {
      log.error("Predict getOpenOrders error", { error: String(err) });
      return [];
    }
  }

  async getOrderStatus(orderId: string): Promise<OrderStatusResult> {
    try {
      const jwt = await this.ensureAuth();

      const res = await fetch(`${this.apiBase}/v1/orders/${orderId}`, {
        headers: {
          Authorization: `Bearer ${jwt}`,
          "x-api-key": this.apiKey,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 401) {
        this.jwt = null;
        return this.getOrderStatus(orderId);
      }

      if (!res.ok) {
        log.warn("Predict getOrderStatus failed", { orderId, status: res.status });
        return { orderId, status: "UNKNOWN", filledSize: 0, remainingSize: 0 };
      }

      const data = (await res.json()) as Record<string, unknown>;
      const rawStatus = String(data.status ?? "UNKNOWN").toUpperCase();

      const status: OrderStatus = (() => {
        switch (rawStatus) {
          case "MATCHED":
          case "FILLED":
            return "FILLED";
          case "LIVE":
          case "OPEN":
            return "OPEN";
          case "PARTIAL":
          case "PARTIALLY_FILLED":
            return "PARTIAL";
          case "CANCELLED":
          case "CANCELED":
            return "CANCELLED";
          case "EXPIRED":
            return "EXPIRED";
          default:
            return "UNKNOWN";
        }
      })();

      const filledSize = Number(data.filledSize ?? data.filled_size ?? 0);
      const originalSize = Number(data.size ?? data.originalSize ?? 0);

      return {
        orderId,
        status,
        filledSize,
        remainingSize: Math.max(0, originalSize - filledSize),
      };
    } catch (err) {
      log.error("Predict getOrderStatus error", { orderId, error: String(err) });
      return { orderId, status: "UNKNOWN", filledSize: 0, remainingSize: 0 };
    }
  }

  async ensureApprovals(publicClient: PublicClient): Promise<void> {
    const account = this.walletClient.account;
    if (!account) throw new Error("WalletClient has no account");

    // Check & set ERC-1155 (CTF token) isApprovedForAll
    try {
      const ctfApproved = await publicClient.readContract({
        address: PREDICT_CTF_ADDRESS,
        abi: ERC1155_ABI,
        functionName: "isApprovedForAll",
        args: [account.address, this.exchangeAddress],
      });
      if (!ctfApproved) {
        log.warn("Predict CTF (ERC-1155) not approved — sending setApprovalForAll", {
          ctf: PREDICT_CTF_ADDRESS,
          exchange: this.exchangeAddress,
          owner: account.address,
        });
        try {
          const txHash = await this.walletClient.writeContract({
            account,
            address: PREDICT_CTF_ADDRESS,
            abi: ERC1155_SET_APPROVAL_ABI,
            functionName: "setApprovalForAll",
            args: [this.exchangeAddress, true],
            chain: this.walletClient.chain,
          });
          log.info("Predict CTF setApprovalForAll tx sent", { txHash });
        } catch (txErr) {
          log.error("Failed to send CTF setApprovalForAll tx", { error: String(txErr) });
        }
      } else {
        log.info("Predict CTF (ERC-1155) approval OK");
      }
    } catch (err) {
      log.error("Failed to check Predict CTF approval", { error: String(err) });
    }

    // Check & set USDT allowance
    try {
      const allowance = await publicClient.readContract({
        address: BSC_USDT_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account.address, this.exchangeAddress],
      });
      if (allowance === 0n) {
        log.warn("Predict USDT allowance is zero — sending approve", {
          usdt: BSC_USDT_ADDRESS,
          exchange: this.exchangeAddress,
          owner: account.address,
        });
        try {
          const txHash = await this.walletClient.writeContract({
            account,
            address: BSC_USDT_ADDRESS,
            abi: ERC20_APPROVE_ABI,
            functionName: "approve",
            args: [this.exchangeAddress, 2n ** 256n - 1n],
            chain: this.walletClient.chain,
          });
          log.info("Predict USDT approve tx sent", { txHash });
        } catch (txErr) {
          log.error("Failed to send USDT approve tx", { error: String(txErr) });
        }
      } else {
        log.info("Predict USDT allowance OK", { allowance: allowance.toString() });
      }
    } catch (err) {
      log.error("Failed to check Predict USDT allowance", { error: String(err) });
    }
  }
}
