import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Executor } from "../execution/executor.js";
import type { ClobClient, OrderStatusResult, PlaceOrderParams } from "../clob/types.js";
import type { ArbitOpportunity, ClobPosition, MarketMeta } from "../types.js";

// ---------------------------------------------------------------------------
// Suppress log output during tests
// ---------------------------------------------------------------------------

vi.mock("../logger.js", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockClobClient(name: string): ClobClient {
  return {
    name,
    exchangeAddress: "0x0000000000000000000000000000000000000001" as `0x${string}`,
    authenticate: vi.fn().mockResolvedValue(undefined),
    placeOrder: vi.fn().mockResolvedValue({ success: true, orderId: `${name}-order-1` }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getOrderStatus: vi.fn().mockResolvedValue({
      orderId: `${name}-order-1`,
      status: "OPEN",
      filledSize: 0,
      remainingSize: 10,
    } satisfies OrderStatusResult),
    ensureApprovals: vi.fn().mockResolvedValue(undefined),
  };
}

function createOpportunity(overrides?: Partial<ArbitOpportunity>): ArbitOpportunity {
  return {
    marketId: "0xaabbccdd00000000000000000000000000000000000000000000000000000001" as `0x${string}`,
    protocolA: "probable",
    protocolB: "predict",
    buyYesOnA: true,
    yesPriceA: BigInt(5e17), // 0.5 in 1e18
    noPriceB: BigInt(4e17),  // 0.4 in 1e18
    totalCost: 900_000n,     // 0.9 USDT in 6-dec
    guaranteedPayout: BigInt(1e18),
    spreadBps: 200,
    grossSpreadBps: 250,
    feesDeducted: 50_000n,
    estProfit: 100_000n,
    liquidityA: 500_000_000n, // 500 USDT in 6-dec
    liquidityB: 500_000_000n,
    ...overrides,
  };
}

const mockMeta: MarketMeta = {
  conditionId: "0xcond1",
  yesTokenId: "111",
  noTokenId: "222",
};

function createMetaResolvers() {
  const resolver = { getMarketMeta: vi.fn().mockReturnValue(mockMeta) };
  return new Map<string, typeof resolver>([
    ["probable", resolver],
    ["predict", resolver],
  ]);
}

const mockConfig = {
  executionMode: "clob" as const,
  dryRun: false,
  fillPollIntervalMs: 100,
  fillPollTimeoutMs: 1000,
  minSpreadBps: 100,
  maxPositionSize: 500_000_000n,
  gasToUsdtRate: 3_000_000_000n,
  dailyLossLimit: 50_000_000n,
} as any;

const mockPublicClient = {
  readContract: vi.fn(),
  getGasPrice: vi.fn(),
} as any;

// ---------------------------------------------------------------------------
// executeClob
// ---------------------------------------------------------------------------

describe("executeClob", () => {
  let clientA: ClobClient;
  let clientB: ClobClient;
  let executor: Executor;

  beforeEach(() => {
    clientA = createMockClobClient("probable");
    clientB = createMockClobClient("predict");
    executor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      createMetaResolvers(),
      undefined,
    );
  });

  it("places both legs and returns FILLED position in dry-run mode", async () => {
    const dryRunConfig = { ...mockConfig, dryRun: true };
    const dryExecutor = new Executor(
      undefined,
      dryRunConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      createMetaResolvers(),
      undefined,
    );

    const opp = createOpportunity();
    const result = await dryExecutor.executeBest(opp, 100_000_000n);

    expect(result).toBeDefined();
    const pos = result as ClobPosition;
    expect(pos.status).toBe("FILLED");
    expect(pos.legA.filled).toBe(true);
    expect(pos.legB.filled).toBe(true);
    expect(clientA.placeOrder).toHaveBeenCalledOnce();
    expect(clientB.placeOrder).toHaveBeenCalledOnce();
  });

  it("returns void when both legs fail", async () => {
    vi.mocked(clientA.placeOrder).mockResolvedValue({ success: false, error: "boom" });
    vi.mocked(clientB.placeOrder).mockResolvedValue({ success: false, error: "crash" });

    const result = await executor.executeBest(createOpportunity(), 100_000_000n);
    expect(result).toBeUndefined();
  });

  it("cancels leg B when leg A fails", async () => {
    vi.mocked(clientA.placeOrder).mockResolvedValue({ success: false, error: "nope" });
    vi.mocked(clientB.placeOrder).mockResolvedValue({ success: true, orderId: "b-order" });

    const result = await executor.executeBest(createOpportunity(), 100_000_000n);
    expect(result).toBeUndefined();
    expect(clientB.cancelOrder).toHaveBeenCalledWith("b-order", expect.any(String));
  });

  it("cancels leg A when leg B fails", async () => {
    vi.mocked(clientA.placeOrder).mockResolvedValue({ success: true, orderId: "a-order" });
    vi.mocked(clientB.placeOrder).mockResolvedValue({ success: false, error: "nah" });

    const result = await executor.executeBest(createOpportunity(), 100_000_000n);
    expect(result).toBeUndefined();
    expect(clientA.cancelOrder).toHaveBeenCalledWith("a-order", expect.any(String));
  });

  it("skips when executor is paused", async () => {
    // Force a pause by reaching into the executor via executeBest -> pollForFills
    // Simpler: just set paused via the pattern the class uses
    // We need to pause it — trigger partial fill in pollForFills
    // Instead, let's use a workaround: create a position, poll for fills, induce partial, then check
    // Actually, the simplest: executeClob is called via executeBest which checks paused first.
    // Let's directly manipulate via a partial fill cycle.

    // Quick approach: make pollForFills return partial by mocking getOrderStatus
    vi.useFakeTimers();
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });
    // placeOrder for unwind attempt
    vi.mocked(clientA.placeOrder)
      .mockResolvedValueOnce({ success: true, orderId: "a-1" })   // leg A
      .mockResolvedValueOnce({ success: false, error: "rejected" }); // unwind attempt

    vi.mocked(clientB.placeOrder).mockResolvedValue({ success: true, orderId: "b-1" });

    const pollPromise = executor.executeBest(createOpportunity(), 100_000_000n);
    await vi.advanceTimersByTimeAsync(2000);
    await pollPromise;

    expect(executor.isPaused()).toBe(true);

    // Now try to execute again — should skip
    vi.mocked(clientA.placeOrder).mockResolvedValue({ success: true, orderId: "a-2" });
    vi.mocked(clientB.placeOrder).mockResolvedValue({ success: true, orderId: "b-2" });
    const result = await executor.executeBest(createOpportunity(), 100_000_000n);
    expect(result).toBeUndefined();

    vi.useRealTimers();
  });

  it("skips when CLOB client missing", async () => {
    const noClientsExecutor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      {},
      createMetaResolvers(),
      undefined,
    );

    const result = await noClientsExecutor.executeBest(createOpportunity(), 100_000_000n);
    expect(result).toBeUndefined();
  });

  it("skips when market meta missing", async () => {
    const emptyResolvers = new Map<string, { getMarketMeta: () => undefined }>([
      ["probable", { getMarketMeta: () => undefined }],
      ["predict", { getMarketMeta: () => undefined }],
    ]);

    const noMetaExecutor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      emptyResolvers as any,
      undefined,
    );

    const result = await noMetaExecutor.executeBest(createOpportunity(), 100_000_000n);
    expect(result).toBeUndefined();
  });

  it("caps position size to liquidity", async () => {
    const dryRunConfig = { ...mockConfig, dryRun: true };
    const dryExecutor = new Executor(
      undefined,
      dryRunConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      createMetaResolvers(),
      undefined,
    );

    // liquidityA = 5 USDT → sizeUsdt should be capped to ~4.5 (5 * 0.9)
    const opp = createOpportunity({
      liquidityA: 5_000_000n,  // 5 USDT
      liquidityB: 500_000_000n,
    });

    await dryExecutor.executeBest(opp, 100_000_000n);

    const placeCallA = vi.mocked(clientA.placeOrder).mock.calls[0]?.[0] as PlaceOrderParams;
    // maxPositionSize/2 = 50 USDT, but liquidityA = 5 USDT, capped to 4.5
    expect(placeCallA.size).toBeLessThanOrEqual(5);
    expect(placeCallA.size).toBeCloseTo(4.5, 1);
  });

  it("skips polling when both legs report FILLED at placement", async () => {
    vi.mocked(clientA.placeOrder).mockResolvedValue({ success: true, orderId: "a-filled", status: "MATCHED" });
    vi.mocked(clientB.placeOrder).mockResolvedValue({ success: true, orderId: "b-filled", status: "MATCHED" });

    const opp = createOpportunity();
    const result = await executor.executeBest(opp, 100_000_000n);

    expect(result).toBeDefined();
    const pos = result as ClobPosition;
    expect(pos.status).toBe("FILLED");
    expect(pos.legA.filled).toBe(true);
    expect(pos.legB.filled).toBe(true);

    // getOrderStatus should never have been called (no polling)
    expect(clientA.getOrderStatus).not.toHaveBeenCalled();
    expect(clientB.getOrderStatus).not.toHaveBeenCalled();
  });

  it("skips when Safe USDT balance is insufficient for Probable leg", async () => {
    const proxyAddr = "0x3333333333333333333333333333333333333333" as `0x${string}`;
    const executorWithProxy = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB, probableProxyAddress: proxyAddr },
      createMetaResolvers(),
      { account: { address: "0x1111111111111111111111111111111111111111" } } as any,
    );

    // EOA USDT check returns enough
    mockPublicClient.readContract
      .mockResolvedValueOnce(1000n * 10n ** 18n) // EOA USDT balance — sufficient
      .mockResolvedValueOnce(1n * 10n ** 18n);   // Safe USDT balance — only 1 USDT, insufficient

    const result = await executorWithProxy.executeBest(createOpportunity(), 100_000_000n);
    expect(result).toBeUndefined();
    // placeOrder should not have been called
    expect(clientA.placeOrder).not.toHaveBeenCalled();
    expect(clientB.placeOrder).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// pollForFills
// ---------------------------------------------------------------------------

describe("pollForFills", () => {
  let clientA: ClobClient;
  let clientB: ClobClient;
  let executor: Executor;

  beforeEach(() => {
    vi.useFakeTimers();
    clientA = createMockClobClient("probable");
    clientB = createMockClobClient("predict");
    executor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      createMetaResolvers(),
      undefined,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makePosition(overrides?: Partial<ClobPosition>): ClobPosition {
    return {
      id: "clob-test-1",
      marketId: "0xaabbccdd00000000000000000000000000000000000000000000000000000001" as `0x${string}`,
      status: "OPEN",
      legA: {
        platform: "probable",
        orderId: "a-order-1",
        tokenId: "111",
        side: "BUY",
        price: 0.5,
        size: 50,
        filled: false,
        filledSize: 0,
      },
      legB: {
        platform: "predict",
        orderId: "b-order-1",
        tokenId: "222",
        side: "BUY",
        price: 0.4,
        size: 50,
        filled: false,
        filledSize: 0,
      },
      totalCost: 100,
      expectedPayout: 110,
      spreadBps: 200,
      openedAt: Date.now(),
      ...overrides,
    };
  }

  it("returns FILLED when both legs fill", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    await vi.advanceTimersByTimeAsync(200);
    const result = await pollPromise;

    expect(result.status).toBe("FILLED");
    expect(result.legA.filled).toBe(true);
    expect(result.legB.filled).toBe(true);
  });

  it("returns EXPIRED when both legs cancel/expire", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "EXPIRED", filledSize: 0, remainingSize: 50,
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    await vi.advanceTimersByTimeAsync(200);
    const result = await pollPromise;

    expect(result.status).toBe("EXPIRED");
  });

  it("sets PARTIAL and pauses when leg A fills but leg B dies", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });
    // Unwind order rejected so executor stays paused
    vi.mocked(clientA.placeOrder).mockResolvedValue({ success: false, error: "rejected" });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pollPromise;

    expect(result.status).toBe("PARTIAL");
    expect(executor.isPaused()).toBe(true);
    expect(result.legA.filled).toBe(true);
  });

  it("sets PARTIAL and pauses when leg B fills but leg A dies", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "EXPIRED", filledSize: 0, remainingSize: 50,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    // Unwind order rejected
    vi.mocked(clientB.placeOrder).mockResolvedValue({ success: false, error: "rejected" });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pollPromise;

    expect(result.status).toBe("PARTIAL");
    expect(executor.isPaused()).toBe(true);
    expect(result.legB.filled).toBe(true);
  });

  it("cancels unfilled legs on timeout", async () => {
    // Both stay OPEN and never fill — timeout
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "OPEN", filledSize: 0, remainingSize: 50,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "OPEN", filledSize: 0, remainingSize: 50,
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    // Advance past the 1000ms timeout
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pollPromise;

    expect(result.status).toBe("EXPIRED");
    expect(clientA.cancelOrder).toHaveBeenCalledWith("a-order-1", "111");
    expect(clientB.cancelOrder).toHaveBeenCalledWith("b-order-1", "222");
  });

  it("handles timeout with one leg filled (partial)", async () => {
    // Leg A stays OPEN during polling, then at the final check it's filled
    // Leg B stays OPEN the whole time
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "OPEN", filledSize: 0, remainingSize: 50,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "OPEN", filledSize: 0, remainingSize: 50,
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);

    // Let the poll loop run for a while...
    await vi.advanceTimersByTimeAsync(800);

    // Now change the status so that when the timeout check happens, A is filled
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "OPEN", filledSize: 0, remainingSize: 50,
    });
    // Unwind order rejected so it stays paused
    vi.mocked(clientA.placeOrder).mockResolvedValue({ success: false, error: "rejected" });

    await vi.advanceTimersByTimeAsync(500);
    const result = await pollPromise;

    expect(result.status).toBe("PARTIAL");
    expect(executor.isPaused()).toBe(true);
    expect(clientB.cancelOrder).toHaveBeenCalledWith("b-order-1", "222");
  });
});

// ---------------------------------------------------------------------------
// attemptUnwind (tested indirectly via pollForFills)
// ---------------------------------------------------------------------------

describe("attemptUnwind", () => {
  let clientA: ClobClient;
  let clientB: ClobClient;
  let executor: Executor;

  beforeEach(() => {
    vi.useFakeTimers();
    clientA = createMockClobClient("probable");
    clientB = createMockClobClient("predict");
    executor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      { probable: clientA, predict: clientB },
      createMetaResolvers(),
      undefined,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makePosition(): ClobPosition {
    return {
      id: "clob-unwind-1",
      marketId: "0xaabbccdd00000000000000000000000000000000000000000000000000000001" as `0x${string}`,
      status: "OPEN",
      legA: {
        platform: "probable",
        orderId: "a-order-1",
        tokenId: "111",
        side: "BUY",
        price: 0.5,
        size: 50,
        filled: false,
        filledSize: 0,
      },
      legB: {
        platform: "predict",
        orderId: "b-order-1",
        tokenId: "222",
        side: "BUY",
        price: 0.4,
        size: 50,
        filled: false,
        filledSize: 0,
      },
      totalCost: 100,
      expectedPayout: 110,
      spreadBps: 200,
      openedAt: Date.now(),
    };
  }

  it("auto-unpauses when unwind order fills", async () => {
    // Leg A fills, leg B dies -> triggers attemptUnwind on clientA
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });

    // Unwind placeOrder succeeds
    vi.mocked(clientA.placeOrder).mockResolvedValue({
      success: true, orderId: "unwind-order-1",
    });

    // First call to getOrderStatus for unwind: OPEN, then FILLED
    let unwindPollCount = 0;
    vi.mocked(clientA.getOrderStatus).mockImplementation(async (orderId: string) => {
      if (orderId === "unwind-order-1") {
        unwindPollCount++;
        if (unwindPollCount >= 2) {
          return { orderId, status: "FILLED", filledSize: 50, remainingSize: 0 };
        }
        return { orderId, status: "OPEN", filledSize: 0, remainingSize: 50 };
      }
      // For the initial leg A poll
      return { orderId, status: "FILLED", filledSize: 50, remainingSize: 0 };
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    // Advance enough time for: initial poll + unwind placement + unwind polls
    // UNWIND_POLL_INTERVAL_MS is 10_000 in the source
    await vi.advanceTimersByTimeAsync(30_000);
    await pollPromise;

    expect(executor.isPaused()).toBe(false);
  });

  it("stays paused when unwind order is rejected", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });

    // Unwind placeOrder succeeds but order rejected (success=false)
    vi.mocked(clientA.placeOrder).mockResolvedValue({
      success: false, error: "insufficient balance",
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    await vi.advanceTimersByTimeAsync(2000);
    await pollPromise;

    expect(executor.isPaused()).toBe(true);
  });

  it("stays paused when unwind order expires", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });

    vi.mocked(clientA.placeOrder).mockResolvedValue({
      success: true, orderId: "unwind-order-1",
    });

    // Unwind order status: EXPIRED
    vi.mocked(clientA.getOrderStatus).mockImplementation(async (orderId: string) => {
      if (orderId === "unwind-order-1") {
        return { orderId, status: "EXPIRED", filledSize: 0, remainingSize: 50 };
      }
      return { orderId, status: "FILLED", filledSize: 50, remainingSize: 0 };
    });

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    // Need enough time for the initial poll + unwind poll interval
    await vi.advanceTimersByTimeAsync(20_000);
    await pollPromise;

    expect(executor.isPaused()).toBe(true);
  });

  it("stays paused on unwind placement error", async () => {
    vi.mocked(clientA.getOrderStatus).mockResolvedValue({
      orderId: "a-order-1", status: "FILLED", filledSize: 50, remainingSize: 0,
    });
    vi.mocked(clientB.getOrderStatus).mockResolvedValue({
      orderId: "b-order-1", status: "CANCELLED", filledSize: 0, remainingSize: 50,
    });

    // placeOrder throws
    vi.mocked(clientA.placeOrder).mockRejectedValue(new Error("network timeout"));

    const pos = makePosition();
    const pollPromise = executor.pollForFills(pos);
    await vi.advanceTimersByTimeAsync(2000);
    await pollPromise;

    expect(executor.isPaused()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// closeResolvedClob
// ---------------------------------------------------------------------------

describe("closeResolvedClob", () => {
  beforeEach(() => {
    mockPublicClient.readContract.mockReset();
    mockPublicClient.getGasPrice.mockReset();
  });

  it("skips non-FILLED positions", async () => {
    const executor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      {},
      createMetaResolvers(),
      { account: { address: "0x1234567890abcdef1234567890abcdef12345678" } } as any,
    );

    const positions: ClobPosition[] = [
      {
        id: "pos-1",
        marketId: "0xaabb" as `0x${string}`,
        status: "OPEN",
        legA: { platform: "probable", orderId: "a", tokenId: "111", side: "BUY", price: 0.5, size: 50, filled: false, filledSize: 0 },
        legB: { platform: "predict", orderId: "b", tokenId: "222", side: "BUY", price: 0.4, size: 50, filled: false, filledSize: 0 },
        totalCost: 100,
        expectedPayout: 110,
        spreadBps: 200,
        openedAt: Date.now(),
      },
      {
        id: "pos-2",
        marketId: "0xaabb" as `0x${string}`,
        status: "PARTIAL",
        legA: { platform: "probable", orderId: "a2", tokenId: "111", side: "BUY", price: 0.5, size: 50, filled: true, filledSize: 50 },
        legB: { platform: "predict", orderId: "b2", tokenId: "222", side: "BUY", price: 0.4, size: 50, filled: false, filledSize: 0 },
        totalCost: 100,
        expectedPayout: 110,
        spreadBps: 200,
        openedAt: Date.now(),
      },
      {
        id: "pos-3",
        marketId: "0xaabb" as `0x${string}`,
        status: "EXPIRED",
        legA: { platform: "probable", orderId: "a3", tokenId: "111", side: "BUY", price: 0.5, size: 50, filled: false, filledSize: 0 },
        legB: { platform: "predict", orderId: "b3", tokenId: "222", side: "BUY", price: 0.4, size: 50, filled: false, filledSize: 0 },
        totalCost: 100,
        expectedPayout: 110,
        spreadBps: 200,
        openedAt: Date.now(),
      },
      {
        id: "pos-4",
        marketId: "0xaabb" as `0x${string}`,
        status: "CLOSED",
        legA: { platform: "probable", orderId: "a4", tokenId: "111", side: "BUY", price: 0.5, size: 50, filled: true, filledSize: 50 },
        legB: { platform: "predict", orderId: "b4", tokenId: "222", side: "BUY", price: 0.4, size: 50, filled: true, filledSize: 50 },
        totalCost: 100,
        expectedPayout: 110,
        spreadBps: 200,
        openedAt: Date.now(),
        closedAt: Date.now(),
      },
    ];

    const closed = await executor.closeResolvedClob(positions);
    // None of these are FILLED, so nothing should be attempted
    expect(closed).toBe(0);
    expect(mockPublicClient.readContract).not.toHaveBeenCalled();
  });

  it("skips when no wallet client", async () => {
    const executor = new Executor(
      undefined,
      mockConfig,
      mockPublicClient,
      {},
      createMetaResolvers(),
      undefined, // no walletClient
    );

    // readContract returns payoutDenominator > 0 — market is resolved
    mockPublicClient.readContract.mockResolvedValue(1n);

    const positions: ClobPosition[] = [
      {
        id: "pos-filled",
        marketId: "0xaabbccdd00000000000000000000000000000000000000000000000000000001" as `0x${string}`,
        status: "FILLED",
        legA: { platform: "probable", orderId: "a1", tokenId: "111", side: "BUY", price: 0.5, size: 50, filled: true, filledSize: 50 },
        legB: { platform: "predict", orderId: "b1", tokenId: "222", side: "BUY", price: 0.4, size: 50, filled: true, filledSize: 50 },
        totalCost: 100,
        expectedPayout: 110,
        spreadBps: 200,
        openedAt: Date.now(),
      },
    ];

    const closed = await executor.closeResolvedClob(positions);
    // Market is resolved but no walletClient, so cannot redeem
    expect(closed).toBe(0);
    expect(positions[0].status).toBe("FILLED"); // unchanged
  });
});
