import { describe, it, expect } from "vitest";
import { buildOrder, serializeOrder } from "../clob/signing.js";
import {
  SIDE_BUY,
  SIDE_SELL,
  SIG_TYPE_EOA,
  ZERO_ADDRESS,
} from "../clob/types.js";
import type { ExecutionMode } from "../types.js";

// ---------------------------------------------------------------------------
// Local re-implementations of unexported discovery helpers for testing.
// These mirror normalizeTitle and jaccardSimilarity from discovery/pipeline.ts.
// ---------------------------------------------------------------------------

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalizeTitle(b).split(" ").filter(Boolean));

  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const SIMILARITY_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAKER = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const SIGNER = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const TOKEN_ID = "12345";
const SCALE = 1_000_000;

// ---------------------------------------------------------------------------
// buildOrder — BUY side
// ---------------------------------------------------------------------------

describe("buildOrder — BUY side", () => {
  const price = 0.5;
  const size = 100;

  const order = buildOrder({
    maker: MAKER,
    signer: SIGNER,
    tokenId: TOKEN_ID,
    side: "BUY",
    price,
    size,
    feeRateBps: 50,
    expirationSec: 600,
    nonce: 1n,
  });

  it("makerAmount should be size * 1e6", () => {
    expect(order.makerAmount).toBe(BigInt(Math.floor(size * SCALE)));
  });

  it("takerAmount should be (size / price) * 1e6", () => {
    expect(order.takerAmount).toBe(BigInt(Math.floor((size / price) * SCALE)));
  });

  it("side should be SIDE_BUY (0)", () => {
    expect(order.side).toBe(SIDE_BUY);
  });

  it("taker should be ZERO_ADDRESS", () => {
    expect(order.taker).toBe(ZERO_ADDRESS);
  });

  it("maker and signer propagated correctly", () => {
    expect(order.maker).toBe(MAKER);
    expect(order.signer).toBe(SIGNER);
  });

  it("feeRateBps propagated correctly", () => {
    expect(order.feeRateBps).toBe(50n);
  });

  it("tokenId propagated as bigint", () => {
    expect(order.tokenId).toBe(BigInt(TOKEN_ID));
  });

  it("nonce propagated correctly", () => {
    expect(order.nonce).toBe(1n);
  });

  it("signatureType should be SIG_TYPE_EOA (0)", () => {
    expect(order.signatureType).toBe(SIG_TYPE_EOA);
  });
});

// ---------------------------------------------------------------------------
// buildOrder — SELL side
// ---------------------------------------------------------------------------

describe("buildOrder — SELL side", () => {
  const price = 0.25;
  const size = 200;

  const order = buildOrder({
    maker: MAKER,
    signer: SIGNER,
    tokenId: TOKEN_ID,
    side: "SELL",
    price,
    size,
    feeRateBps: 100,
    expirationSec: 300,
    nonce: 2n,
  });

  it("makerAmount should be (size / price) * 1e6", () => {
    expect(order.makerAmount).toBe(BigInt(Math.floor((size / price) * SCALE)));
  });

  it("takerAmount should be size * 1e6", () => {
    expect(order.takerAmount).toBe(BigInt(Math.floor(size * SCALE)));
  });

  it("side should be SIDE_SELL (1)", () => {
    expect(order.side).toBe(SIDE_SELL);
  });

  it("feeRateBps propagated correctly", () => {
    expect(order.feeRateBps).toBe(100n);
  });
});

// ---------------------------------------------------------------------------
// buildOrder — expiration & salt
// ---------------------------------------------------------------------------

describe("buildOrder — expiration and salt", () => {
  it("expiration should be in the future", () => {
    const order = buildOrder({
      maker: MAKER,
      signer: SIGNER,
      tokenId: TOKEN_ID,
      side: "BUY",
      price: 0.5,
      size: 10,
      feeRateBps: 0,
      expirationSec: 600,
      nonce: 0n,
    });

    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    expect(order.expiration).toBeGreaterThan(nowSec);
  });

  it("salt should be non-zero (random)", () => {
    const order = buildOrder({
      maker: MAKER,
      signer: SIGNER,
      tokenId: TOKEN_ID,
      side: "BUY",
      price: 0.5,
      size: 10,
      feeRateBps: 0,
      expirationSec: 600,
      nonce: 0n,
    });

    // While theoretically possible that Math.random() yields exactly 0,
    // the probability is vanishingly small. This is a sanity check.
    expect(order.salt).not.toBe(0n);
  });

  it("two orders should have different salts", () => {
    const params = {
      maker: MAKER,
      signer: SIGNER,
      tokenId: TOKEN_ID,
      side: "BUY" as const,
      price: 0.5,
      size: 10,
      feeRateBps: 0,
      expirationSec: 600,
      nonce: 0n,
    };

    const order1 = buildOrder(params);
    const order2 = buildOrder(params);
    expect(order1.salt).not.toBe(order2.salt);
  });
});

// ---------------------------------------------------------------------------
// serializeOrder
// ---------------------------------------------------------------------------

describe("serializeOrder", () => {
  const order = buildOrder({
    maker: MAKER,
    signer: SIGNER,
    tokenId: TOKEN_ID,
    side: "BUY",
    price: 0.5,
    size: 100,
    feeRateBps: 50,
    expirationSec: 600,
    nonce: 7n,
  });

  const serialized = serializeOrder(order);

  it("converts all bigint fields to strings", () => {
    expect(typeof serialized.salt).toBe("string");
    expect(typeof serialized.tokenId).toBe("string");
    expect(typeof serialized.makerAmount).toBe("string");
    expect(typeof serialized.takerAmount).toBe("string");
    expect(typeof serialized.expiration).toBe("string");
    expect(typeof serialized.nonce).toBe("string");
    expect(typeof serialized.feeRateBps).toBe("string");
  });

  it("preserves address fields as strings", () => {
    expect(serialized.maker).toBe(MAKER);
    expect(serialized.signer).toBe(SIGNER);
    expect(serialized.taker).toBe(ZERO_ADDRESS);
  });

  it("serializes side as string and preserves signatureType", () => {
    expect(serialized.side).toBe("BUY");
    expect(serialized.signatureType).toBe(SIG_TYPE_EOA);
  });

  it("nonce serialized correctly", () => {
    expect(serialized.nonce).toBe("7");
  });

  it("contains no bigint values anywhere", () => {
    for (const value of Object.values(serialized)) {
      expect(typeof value).not.toBe("bigint");
    }
  });
});

// ---------------------------------------------------------------------------
// ClobOrder type constants
// ---------------------------------------------------------------------------

describe("ClobOrder constants", () => {
  it("SIDE_BUY is 0", () => {
    expect(SIDE_BUY).toBe(0);
  });

  it("SIDE_SELL is 1", () => {
    expect(SIDE_SELL).toBe(1);
  });

  it("SIG_TYPE_EOA is 0", () => {
    expect(SIG_TYPE_EOA).toBe(0);
  });

  it("ZERO_ADDRESS is the 40-hex-char zero address", () => {
    expect(ZERO_ADDRESS).toBe("0x0000000000000000000000000000000000000000");
  });
});

// ---------------------------------------------------------------------------
// Title similarity (mirroring discovery/pipeline.ts helpers)
// ---------------------------------------------------------------------------

describe("normalizeTitle", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeTitle("FIFA World Cup 2026!")).toBe("fifa world cup 2026");
  });

  it("collapses multiple spaces", () => {
    expect(normalizeTitle("  hello   world  ")).toBe("hello world");
  });

  it("replaces special characters with spaces", () => {
    expect(normalizeTitle("A-B/C@D")).toBe("a b c d");
  });

  it("handles empty string", () => {
    expect(normalizeTitle("")).toBe("");
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical titles", () => {
    expect(jaccardSimilarity("FIFA World Cup 2026", "FIFA World Cup 2026")).toBe(1);
  });

  it("returns 0 for completely different titles", () => {
    expect(jaccardSimilarity("alpha beta gamma", "delta epsilon zeta")).toBe(0);
  });

  it("returns 1 for both empty strings", () => {
    expect(jaccardSimilarity("", "")).toBe(1);
  });

  it("returns 0 when one is empty and the other is not", () => {
    expect(jaccardSimilarity("", "hello")).toBe(0);
    expect(jaccardSimilarity("hello", "")).toBe(0);
  });

  it("above threshold for near-match titles", () => {
    const sim = jaccardSimilarity(
      "FIFA World Cup 2026 Winner",
      "FIFA World Cup 2026 - Winner",
    );
    expect(sim).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it("below threshold for different events", () => {
    const sim = jaccardSimilarity("FIFA World Cup 2026", "NBA Finals 2026");
    expect(sim).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  it("handles punctuation differences gracefully", () => {
    const sim = jaccardSimilarity(
      "Will Bitcoin hit $100,000?",
      "Will Bitcoin hit $100,000",
    );
    expect(sim).toBe(1);
  });

  it("case-insensitive comparison", () => {
    expect(jaccardSimilarity("Hello World", "hello world")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ExecutionMode type
// ---------------------------------------------------------------------------

describe("ExecutionMode type", () => {
  it('accepts "vault"', () => {
    const mode: ExecutionMode = "vault";
    expect(mode).toBe("vault");
  });

  it('accepts "clob"', () => {
    const mode: ExecutionMode = "clob";
    expect(mode).toBe("clob");
  });
});
