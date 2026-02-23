import type { PublicClient, WalletClient } from "viem"
import type {
  ClobClient,
  PlaceOrderParams,
  OrderResult,
  OrderSide,
  OrderStatusResult,
  OrderStatus,
} from "./types.js"
import { buildOrder, signOrder, signClobAuth, serializeOrder } from "./signing.js"
import { log } from "../logger.js"
import { withRetry } from "../retry.js"

/** Probable Markets CTF (ERC-1155 conditional tokens) */
const PROBABLE_CTF_ADDRESS = "0x364d05055614B506e2b9A287E4ac34167204cA83" as `0x${string}`

/** Minimal ABI fragments for approval checks */
const ERC1155_IS_APPROVED_ABI = [{
  type: "function" as const,
  name: "isApprovedForAll" as const,
  inputs: [
    { name: "account", type: "address" as const },
    { name: "operator", type: "address" as const },
  ],
  outputs: [{ name: "", type: "bool" as const }],
  stateMutability: "view" as const,
}] as const

const ERC20_ALLOWANCE_ABI = [{
  type: "function" as const,
  name: "allowance" as const,
  inputs: [
    { name: "owner", type: "address" as const },
    { name: "spender", type: "address" as const },
  ],
  outputs: [{ name: "", type: "uint256" as const }],
  stateMutability: "view" as const,
}] as const

/** BSC USDT */
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955" as `0x${string}`

export class ProbableClobClient implements ClobClient {
  readonly name = "Probable"
  readonly exchangeAddress: `0x${string}`

  private walletClient: WalletClient
  private apiBase: string
  private chainId: number
  private feeRateBps: number
  private expirationSec: number
  private dryRun: boolean
  private nonce: bigint

  constructor(params: {
    walletClient: WalletClient
    apiBase: string
    exchangeAddress: `0x${string}`
    chainId: number
    expirationSec?: number
    dryRun?: boolean
  }) {
    this.walletClient = params.walletClient
    this.apiBase = params.apiBase.replace(/\/+$/, "")
    this.exchangeAddress = params.exchangeAddress
    this.chainId = params.chainId
    this.feeRateBps = 0
    this.expirationSec = params.expirationSec ?? 300
    this.dryRun = params.dryRun ?? false
    this.nonce = 0n
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const auth = await signClobAuth(this.walletClient, this.chainId)
    return {
      POLY_ADDRESS: auth.address,
      POLY_SIGNATURE: auth.signature,
      POLY_TIMESTAMP: auth.timestamp,
      POLY_NONCE: "0",
    }
  }

  // ---------------------------------------------------------------------------
  // ClobClient interface
  // ---------------------------------------------------------------------------

  async authenticate(): Promise<void> {
    // No-op: Probable uses per-request POLY_* auth headers
    log.info("Probable auth is per-request, skipping session auth")
  }

  async placeOrder(params: PlaceOrderParams): Promise<OrderResult> {
    const account = this.walletClient.account
    if (!account) return { success: false, error: "WalletClient has no account" }

    const { tokenId, side, price, size } = params

    try {
      const order = buildOrder({
        maker: account.address,
        signer: account.address,
        tokenId,
        side,
        price,
        size,
        feeRateBps: this.feeRateBps,
        expirationSec: this.expirationSec,
        nonce: this.nonce,
      })

      const signed = await signOrder(
        this.walletClient,
        order,
        this.chainId,
        this.exchangeAddress,
      )

      const serialized = serializeOrder(signed.order)
      const body = { order: serialized, signature: signed.signature }

      log.info("Probable order built", {
        tokenId,
        side,
        price,
        size,
        nonce: this.nonce,
        dryRun: this.dryRun,
      })

      if (this.dryRun) {
        log.info("DRY RUN: skipping POST", { body })
        this.nonce++
        return { success: true, orderId: "dry-run", status: "DRY_RUN" }
      }

      const headers = await this.getAuthHeaders()

      const res = await withRetry(
        () =>
          fetch(`${this.apiBase}/public/api/v1/order`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
          }),
        { retries: 2, delayMs: 500, label: "Probable placeOrder" },
      )

      const data = await res.json() as Record<string, unknown>

      if (!res.ok) {
        log.error("Probable placeOrder failed", { status: res.status, data })
        return {
          success: false,
          error: typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
        }
      }

      this.nonce++
      log.info("Probable order placed", { data })

      return {
        success: true,
        orderId: typeof data.orderID === "string" ? data.orderID : (data.orderId as string | undefined),
        status: typeof data.status === "string" ? data.status : "SUBMITTED",
        transactionHash: typeof data.transactionsHashes === "string"
          ? data.transactionsHashes
          : undefined,
      }
    } catch (err) {
      log.error("Probable placeOrder error", { error: String(err) })
      return { success: false, error: String(err) }
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (this.dryRun) {
      log.info("DRY RUN: skipping cancel", { orderId })
      return true
    }

    try {
      const headers = await this.getAuthHeaders()

      const res = await withRetry(
        () =>
          fetch(`${this.apiBase}/public/api/v1/order/${orderId}`, {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            signal: AbortSignal.timeout(10_000),
          }),
        { retries: 2, delayMs: 500, label: "Probable cancelOrder" },
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as Record<string, unknown>
        log.error("Probable cancelOrder failed", { status: res.status, data })
        return false
      }

      log.info("Probable order cancelled", { orderId })
      return true
    } catch (err) {
      log.error("Probable cancelOrder error", { error: String(err) })
      return false
    }
  }

  async getOpenOrders(): Promise<Array<{ orderId: string; tokenId: string; side: OrderSide; price: number; size: number }>> {
    try {
      const headers = await this.getAuthHeaders()

      const res = await withRetry(
        () =>
          fetch(`${this.apiBase}/public/api/v1/orders`, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(10_000),
          }),
        { retries: 2, delayMs: 500, label: "Probable getOpenOrders" },
      )

      if (!res.ok) {
        log.error("Probable getOpenOrders failed", { status: res.status })
        return []
      }

      const data = await res.json() as Array<Record<string, unknown>>
      return data.map((o) => ({
        orderId: String(o.orderID ?? o.orderId ?? o.id ?? ""),
        tokenId: String(o.tokenId ?? o.asset_id ?? ""),
        side: (String(o.side).toUpperCase() === "SELL" ? "SELL" : "BUY") as OrderSide,
        price: Number(o.price ?? 0),
        size: Number(o.size ?? o.original_size ?? 0),
      }))
    } catch (err) {
      log.error("Probable getOpenOrders error", { error: String(err) })
      return []
    }
  }

  async getOrderStatus(orderId: string): Promise<OrderStatusResult> {
    try {
      const headers = await this.getAuthHeaders()

      const res = await withRetry(
        () =>
          fetch(`${this.apiBase}/public/api/v1/order/${orderId}`, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(10_000),
          }),
        { retries: 2, delayMs: 500, label: "Probable getOrderStatus" },
      )

      if (!res.ok) {
        log.warn("Probable getOrderStatus failed", { orderId, status: res.status })
        return { orderId, status: "UNKNOWN", filledSize: 0, remainingSize: 0 }
      }

      const data = await res.json() as Record<string, unknown>
      const rawStatus = String(data.status ?? data.order_status ?? "UNKNOWN").toUpperCase()

      const status: OrderStatus = (() => {
        switch (rawStatus) {
          case "MATCHED":
          case "FILLED":
            return "FILLED"
          case "LIVE":
          case "OPEN":
            return "OPEN"
          case "PARTIAL":
          case "PARTIALLY_FILLED":
            return "PARTIAL"
          case "CANCELLED":
          case "CANCELED":
            return "CANCELLED"
          case "EXPIRED":
            return "EXPIRED"
          default:
            return "UNKNOWN"
        }
      })()

      const filledSize = Number(data.filled_size ?? data.filledSize ?? data.size_matched ?? 0)
      const originalSize = Number(data.original_size ?? data.size ?? data.originalSize ?? 0)

      return {
        orderId,
        status,
        filledSize,
        remainingSize: Math.max(0, originalSize - filledSize),
      }
    } catch (err) {
      log.error("Probable getOrderStatus error", { orderId, error: String(err) })
      return { orderId, status: "UNKNOWN", filledSize: 0, remainingSize: 0 }
    }
  }

  async ensureApprovals(publicClient: PublicClient): Promise<void> {
    const account = this.walletClient.account
    if (!account) {
      log.warn("Cannot check approvals: WalletClient has no account")
      return
    }

    const owner = account.address

    // Check ERC-1155 CTF approval
    const isApproved = await publicClient.readContract({
      address: PROBABLE_CTF_ADDRESS,
      abi: ERC1155_IS_APPROVED_ABI,
      functionName: "isApprovedForAll",
      args: [owner, this.exchangeAddress],
    })

    if (!isApproved) {
      log.warn("CTF ERC-1155 not approved for Probable exchange", {
        ctf: PROBABLE_CTF_ADDRESS,
        exchange: this.exchangeAddress,
        owner,
      })
    }

    // Check USDT allowance
    const allowance = await publicClient.readContract({
      address: BSC_USDT,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: "allowance",
      args: [owner, this.exchangeAddress],
    })

    if (allowance === 0n) {
      log.warn("USDT allowance is 0 for Probable exchange", {
        usdt: BSC_USDT,
        exchange: this.exchangeAddress,
        owner,
      })
    } else {
      log.info("USDT allowance for Probable exchange", { allowance })
    }
  }

  // ---------------------------------------------------------------------------
  // Nonce management
  // ---------------------------------------------------------------------------

  async fetchNonce(): Promise<bigint> {
    try {
      const headers = await this.getAuthHeaders()

      const res = await withRetry(
        () =>
          fetch(`${this.apiBase}/public/api/v1/nonce`, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(10_000),
          }),
        { retries: 2, delayMs: 500, label: "Probable fetchNonce" },
      )

      if (!res.ok) {
        log.warn("Probable fetchNonce failed, defaulting to 0", { status: res.status })
        this.nonce = 0n
        return this.nonce
      }

      const data = await res.json() as Record<string, unknown>
      const raw = data.nonce ?? data.next_nonce ?? 0
      this.nonce = BigInt(Number(raw))
      log.info("Probable nonce fetched", { nonce: this.nonce })
      return this.nonce
    } catch (err) {
      log.warn("Probable fetchNonce error, defaulting to 0", { error: String(err) })
      this.nonce = 0n
      return this.nonce
    }
  }
}
