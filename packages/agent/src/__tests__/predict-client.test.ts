import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PredictClobClient } from "../clob/predict-client.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Silence logger output during tests
vi.mock("../logger.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock signing to avoid real crypto; returns deterministic values
vi.mock("../clob/signing.js", () => ({
  buildOrder: vi.fn(() => ({
    salt: 42n,
    maker: "0x1111111111111111111111111111111111111111",
    signer: "0x1111111111111111111111111111111111111111",
    taker: "0x0000000000000000000000000000000000000000",
    tokenId: 999n,
    makerAmount: 100000000000000000000n,
    takerAmount: 200000000000000000000n,
    expiration: 9999999999n,
    nonce: 0n,
    feeRateBps: 200n,
    side: 0,
    signatureType: 0,
  })),
  signOrder: vi.fn(async () => ({
    order: {} as any,
    signature: "0xmocktypedsig" as `0x${string}`,
  })),
}));

// Mock viem's hashTypedData
vi.mock("viem", async () => {
  const actual = await vi.importActual("viem");
  return {
    ...actual,
    hashTypedData: vi.fn(() => "0xmockhash"),
  };
});

// Mock withRetry to just call the function directly (no delays)
vi.mock("../retry.js", () => ({
  withRetry: vi.fn(async (fn: () => Promise<any>) => fn()),
}));

const mockAccount = {
  address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
};

const mockWalletClient = {
  account: mockAccount,
  signMessage: vi.fn().mockResolvedValue("0xmocksig"),
  signTypedData: vi.fn().mockResolvedValue("0xmocktypedsig"),
  writeContract: vi.fn().mockResolvedValue("0xmocktxhash"),
  chain: { id: 56 },
} as any;

const mockPublicClient = {
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", blockNumber: 100n }),
} as any;

const API_BASE = "https://api.predict.test";
const API_KEY = "test-api-key";
const EXCHANGE = "0x8BC070BEdAB741406F4B1Eb65A72bee27894B689" as `0x${string}`;

function createClient(opts?: { dryRun?: boolean }) {
  return new PredictClobClient({
    walletClient: mockWalletClient,
    apiBase: API_BASE,
    apiKey: API_KEY,
    exchangeAddress: EXCHANGE,
    chainId: 56,
    dryRun: opts?.dryRun ?? false,
  });
}

// Build a fake JWT with an exp claim far in the future
function fakeJwt(exp = Math.floor(Date.now() / 1000) + 3600) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64");
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64");
  return `${header}.${payload}.fakesig`;
}

// Helper: build a mock Response object
function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helper to set up auth mocks (auth message + login) so ensureAuth succeeds
// ---------------------------------------------------------------------------

function mockAuthSequence(jwt?: string) {
  const token = jwt ?? fakeJwt();
  // GET /v1/auth/message
  mockFetch.mockResolvedValueOnce(
    mockResponse({ success: true, data: { message: "sign this" } }),
  );
  // POST /v1/auth
  mockFetch.mockResolvedValueOnce(
    mockResponse({ data: { token } }),
  );
  return token;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("PredictClobClient", () => {
  // -------------------------------------------------------------------------
  // authenticate
  // -------------------------------------------------------------------------

  describe("authenticate", () => {
    it("gets auth message and signs it to obtain JWT", async () => {
      const client = createClient();
      const jwt = fakeJwt();

      mockFetch
        .mockResolvedValueOnce(mockResponse({ success: true, data: { message: "sign this" } }))
        .mockResolvedValueOnce(mockResponse({ data: { token: jwt } }));

      await client.authenticate();

      // Should have fetched auth message
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [msgUrl, msgOpts] = mockFetch.mock.calls[0];
      expect(msgUrl).toBe(`${API_BASE}/v1/auth/message`);
      expect(msgOpts.headers["x-api-key"]).toBe(API_KEY);

      // Should have signed the message
      expect(mockWalletClient.signMessage).toHaveBeenCalledWith({
        account: mockAccount,
        message: "sign this",
      });

      // Should have posted login
      const [loginUrl, loginOpts] = mockFetch.mock.calls[1];
      expect(loginUrl).toBe(`${API_BASE}/v1/auth`);
      expect(loginOpts.method).toBe("POST");
      const loginBody = JSON.parse(loginOpts.body);
      expect(loginBody.signer).toBe(mockAccount.address);
      expect(loginBody.signature).toBe("0xmocksig");
    });

    it("throws on auth message failure", async () => {
      const client = createClient();

      mockFetch.mockResolvedValueOnce(mockResponse("forbidden", 403));

      await expect(client.authenticate()).rejects.toThrow("Predict auth/message failed (403)");
    });

    it("throws on login failure", async () => {
      const client = createClient();

      mockFetch
        .mockResolvedValueOnce(mockResponse({ success: true, data: { message: "sign this" } }))
        .mockResolvedValueOnce(mockResponse("unauthorized", 401));

      await expect(client.authenticate()).rejects.toThrow("Predict auth/login failed (401)");
    });
  });

  // -------------------------------------------------------------------------
  // placeOrder
  // -------------------------------------------------------------------------

  describe("placeOrder", () => {
    it("places order successfully and increments nonce", async () => {
      const client = createClient();
      expect(client.getNonce()).toBe(0n);

      // Auth sequence
      mockAuthSequence();
      // GET /v1/markets/{marketId} for exchange resolution
      mockFetch.mockResolvedValueOnce(mockResponse({ isNegRisk: false, isYieldBearing: false }));
      // POST /v1/orders
      mockFetch.mockResolvedValueOnce(mockResponse({ orderId: "order-123", status: "OPEN" }));

      const result = await client.placeOrder({
        tokenId: "999",
        side: "BUY",
        price: 0.5,
        size: 100,
        marketId: "market-abc",
      });

      expect(result.success).toBe(true);
      expect(result.orderId).toBe("order-123");
      expect(result.status).toBe("OPEN");
      expect(client.getNonce()).toBe(1n);
    });

    it("returns dry-run result without calling orders API", async () => {
      const client = createClient({ dryRun: true });

      // Auth sequence
      mockAuthSequence();
      // GET /v1/markets/{marketId}
      mockFetch.mockResolvedValueOnce(mockResponse({ isNegRisk: false, isYieldBearing: false }));

      const result = await client.placeOrder({
        tokenId: "999",
        side: "BUY",
        price: 0.5,
        size: 100,
        marketId: "market-abc",
      });

      expect(result.success).toBe(true);
      expect(result.orderId).toBe("dry-run");
      expect(result.status).toBe("dry-run");

      // Should NOT have called POST /v1/orders
      const postOrderCalls = mockFetch.mock.calls.filter(
        (c: any[]) => c[0] === `${API_BASE}/v1/orders` && c[1]?.method === "POST",
      );
      expect(postOrderCalls).toHaveLength(0);
    });

    it("returns error result on API failure", async () => {
      const client = createClient();

      // Auth sequence
      mockAuthSequence();
      // GET /v1/markets/{marketId}
      mockFetch.mockResolvedValueOnce(mockResponse({ isNegRisk: false, isYieldBearing: false }));
      // POST /v1/orders — failure
      mockFetch.mockResolvedValueOnce(mockResponse("Internal Server Error", 500));

      const result = await client.placeOrder({
        tokenId: "999",
        side: "BUY",
        price: 0.5,
        size: 100,
        marketId: "market-abc",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("does not increment nonce on failure", async () => {
      const client = createClient();
      expect(client.getNonce()).toBe(0n);

      // Auth sequence
      mockAuthSequence();
      // GET /v1/markets/{marketId}
      mockFetch.mockResolvedValueOnce(mockResponse({ isNegRisk: false, isYieldBearing: false }));
      // POST /v1/orders — failure
      mockFetch.mockResolvedValueOnce(mockResponse("Internal Server Error", 500));

      await client.placeOrder({
        tokenId: "999",
        side: "BUY",
        price: 0.5,
        size: 100,
        marketId: "market-abc",
      });

      expect(client.getNonce()).toBe(0n);
    });
  });

  // -------------------------------------------------------------------------
  // getOpenOrders
  // -------------------------------------------------------------------------

  describe("getOpenOrders", () => {
    it("returns parsed open orders", async () => {
      const client = createClient();

      // Auth
      mockAuthSequence();
      // GET /v1/orders?address=...&status=OPEN
      mockFetch.mockResolvedValueOnce(
        mockResponse([
          { orderId: "o1", tokenId: "t1", side: "BUY", price: 0.5, size: 100 },
          { orderId: "o2", tokenId: "t2", side: "SELL", price: "0.75", size: "200" },
        ]),
      );

      const orders = await client.getOpenOrders();

      expect(orders).toHaveLength(2);
      expect(orders[0]).toEqual({
        orderId: "o1",
        tokenId: "t1",
        side: "BUY",
        price: 0.5,
        size: 100,
      });
      expect(orders[1]).toEqual({
        orderId: "o2",
        tokenId: "t2",
        side: "SELL",
        price: 0.75,
        size: 200,
      });
    });

    it("retries once on 401, not infinitely", async () => {
      const client = createClient();

      // First call: ensureAuth succeeds
      mockAuthSequence();
      // GET /v1/orders — returns 401
      mockFetch.mockResolvedValueOnce(mockResponse("Unauthorized", 401));

      // Re-auth triggered (jwt nulled, ensureAuth called again)
      mockAuthSequence();
      // Retry GET /v1/orders — now succeeds
      mockFetch.mockResolvedValueOnce(
        mockResponse([{ orderId: "o1", tokenId: "t1", side: "BUY", price: 0.5, size: 50 }]),
      );

      const orders = await client.getOpenOrders();

      expect(orders).toHaveLength(1);
      expect(orders[0].orderId).toBe("o1");
    });

    it("returns empty array after failed re-auth retry", async () => {
      const client = createClient();

      // First call: ensureAuth succeeds
      mockAuthSequence();
      // GET /v1/orders — 401
      mockFetch.mockResolvedValueOnce(mockResponse("Unauthorized", 401));

      // Re-auth for retry
      mockAuthSequence();
      // Retry GET /v1/orders — 401 again
      mockFetch.mockResolvedValueOnce(mockResponse("Unauthorized", 401));

      const orders = await client.getOpenOrders();

      // Should return empty, not recurse infinitely
      expect(orders).toEqual([]);
    });

    it("returns empty array on non-401 error", async () => {
      const client = createClient();

      // Auth
      mockAuthSequence();
      // GET /v1/orders — 500
      mockFetch.mockResolvedValueOnce(mockResponse("Server Error", 500));

      const orders = await client.getOpenOrders();
      expect(orders).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getOrderStatus
  // -------------------------------------------------------------------------

  describe("getOrderStatus", () => {
    it("returns parsed order status", async () => {
      const client = createClient();

      // Auth
      mockAuthSequence();
      // GET /v1/orders/{orderId}
      mockFetch.mockResolvedValueOnce(
        mockResponse({ status: "FILLED", filledSize: 100, size: 100 }),
      );

      const result = await client.getOrderStatus("order-123");

      expect(result.orderId).toBe("order-123");
      expect(result.status).toBe("FILLED");
      expect(result.filledSize).toBe(100);
      expect(result.remainingSize).toBe(0);
    });

    it("retries once on 401, not infinitely", async () => {
      const client = createClient();

      // First ensureAuth
      mockAuthSequence();
      // GET /v1/orders/order-123 — 401
      mockFetch.mockResolvedValueOnce(mockResponse("Unauthorized", 401));

      // Re-auth
      mockAuthSequence();
      // Retry GET — succeeds
      mockFetch.mockResolvedValueOnce(
        mockResponse({ status: "OPEN", filledSize: 0, size: 50 }),
      );

      const result = await client.getOrderStatus("order-123");

      expect(result.status).toBe("OPEN");
      expect(result.filledSize).toBe(0);
      expect(result.remainingSize).toBe(50);
    });

    it("returns UNKNOWN after failed re-auth retry", async () => {
      const client = createClient();

      // First ensureAuth
      mockAuthSequence();
      // GET — 401
      mockFetch.mockResolvedValueOnce(mockResponse("Unauthorized", 401));

      // Re-auth
      mockAuthSequence();
      // Retry — 401 again
      mockFetch.mockResolvedValueOnce(mockResponse("Unauthorized", 401));

      const result = await client.getOrderStatus("order-123");

      expect(result.status).toBe("UNKNOWN");
      expect(result.filledSize).toBe(0);
      expect(result.remainingSize).toBe(0);
    });

    it("maps MATCHED to FILLED", async () => {
      const client = createClient();

      mockAuthSequence();
      mockFetch.mockResolvedValueOnce(
        mockResponse({ status: "MATCHED", filledSize: 50, size: 50 }),
      );

      const result = await client.getOrderStatus("order-456");
      expect(result.status).toBe("FILLED");
    });

    it("maps LIVE to OPEN", async () => {
      const client = createClient();

      mockAuthSequence();
      mockFetch.mockResolvedValueOnce(
        mockResponse({ status: "LIVE", filledSize: 0, size: 100 }),
      );

      const result = await client.getOrderStatus("order-789");
      expect(result.status).toBe("OPEN");
    });
  });

  // -------------------------------------------------------------------------
  // ensureApprovals
  // -------------------------------------------------------------------------

  describe("ensureApprovals", () => {
    it("waits for CTF approval receipt", async () => {
      const client = createClient();

      // CTF not approved, USDT already approved
      mockPublicClient.readContract
        .mockResolvedValueOnce(false)   // isApprovedForAll → false
        .mockResolvedValueOnce(1n);     // USDT allowance > 0

      mockWalletClient.writeContract.mockResolvedValueOnce("0xctftxhash");
      mockPublicClient.waitForTransactionReceipt.mockResolvedValueOnce({
        status: "success",
        blockNumber: 100n,
      });

      await client.ensureApprovals(mockPublicClient);

      expect(mockWalletClient.writeContract).toHaveBeenCalledTimes(1);
      expect(mockPublicClient.waitForTransactionReceipt).toHaveBeenCalledWith({
        hash: "0xctftxhash",
      });
    });

    it("waits for USDT approval receipt", async () => {
      const client = createClient();

      // CTF already approved, USDT not approved
      mockPublicClient.readContract
        .mockResolvedValueOnce(true)  // isApprovedForAll → true
        .mockResolvedValueOnce(0n);   // USDT allowance = 0

      mockWalletClient.writeContract.mockResolvedValueOnce("0xusdttxhash");
      mockPublicClient.waitForTransactionReceipt.mockResolvedValueOnce({
        status: "success",
        blockNumber: 101n,
      });

      await client.ensureApprovals(mockPublicClient);

      expect(mockWalletClient.writeContract).toHaveBeenCalledTimes(1);
      expect(mockPublicClient.waitForTransactionReceipt).toHaveBeenCalledWith({
        hash: "0xusdttxhash",
      });
    });

    it("skips approval when already approved", async () => {
      const client = createClient();

      // Both already approved
      mockPublicClient.readContract
        .mockResolvedValueOnce(true)   // isApprovedForAll → true
        .mockResolvedValueOnce(1n);    // USDT allowance > 0

      await client.ensureApprovals(mockPublicClient);

      expect(mockWalletClient.writeContract).not.toHaveBeenCalled();
      expect(mockPublicClient.waitForTransactionReceipt).not.toHaveBeenCalled();
    });

    it("logs error when receipt is reverted", async () => {
      const { log } = await import("../logger.js");
      const client = createClient();

      // CTF not approved
      mockPublicClient.readContract
        .mockResolvedValueOnce(false)  // isApprovedForAll → false
        .mockResolvedValueOnce(1n);    // USDT OK

      mockWalletClient.writeContract.mockResolvedValueOnce("0xrevertedtx");
      mockPublicClient.waitForTransactionReceipt.mockResolvedValueOnce({
        status: "reverted",
        blockNumber: 102n,
      });

      await client.ensureApprovals(mockPublicClient);

      expect(log.error).toHaveBeenCalledWith(
        "Predict CTF setApprovalForAll reverted",
        expect.objectContaining({ txHash: "0xrevertedtx" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // nonce management
  // -------------------------------------------------------------------------

  describe("nonce management", () => {
    it("getNonce returns current nonce", () => {
      const client = createClient();
      expect(client.getNonce()).toBe(0n);
    });

    it("setNonce updates nonce", () => {
      const client = createClient();
      client.setNonce(42n);
      expect(client.getNonce()).toBe(42n);
    });

    it("nonce increments after successful order", async () => {
      const client = createClient();
      client.setNonce(5n);

      mockAuthSequence();
      mockFetch.mockResolvedValueOnce(mockResponse({ isNegRisk: false, isYieldBearing: false }));
      mockFetch.mockResolvedValueOnce(mockResponse({ orderId: "ord-1", status: "OPEN" }));

      await client.placeOrder({
        tokenId: "999",
        side: "BUY",
        price: 0.5,
        size: 100,
        marketId: "mkt-1",
      });

      expect(client.getNonce()).toBe(6n);
    });

    it("nonce does not increment after failed order", async () => {
      const client = createClient();
      client.setNonce(5n);

      mockAuthSequence();
      mockFetch.mockResolvedValueOnce(mockResponse({ isNegRisk: false, isYieldBearing: false }));
      mockFetch.mockResolvedValueOnce(mockResponse("Bad Request", 400));

      await client.placeOrder({
        tokenId: "999",
        side: "BUY",
        price: 0.5,
        size: 100,
        marketId: "mkt-1",
      });

      expect(client.getNonce()).toBe(5n);
    });
  });
});
