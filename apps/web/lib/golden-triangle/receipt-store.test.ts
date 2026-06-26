import { describe, expect, it } from "vitest";

import type { GoldenTriangleReceipt } from "./receipt";
import { listGoldenTriangleReceipts, recordGoldenTriangleReceipt, type ReceiptStoreClient } from "./receipt-store";

function receipt(tag: string): GoldenTriangleReceipt {
  return {
    preset: "assured",
    governedBy: "platform",
    requested: { minimumTier: "frontier" },
    actual: { modelId: tag, tier: "frontier", costUsd: 0.1, latencyMs: 1000, fallbackOccurred: false, verificationPassed: null, accepted: null },
    deviations: [],
    matchedRequest: true,
    summary: `summary-${tag}`,
  };
}

type Row = { interactionId: string; outcomePayload: unknown; createdAt: Date; routeContext: string | null };

function fakeClient(rows: Row[]): ReceiptStoreClient {
  return {
    decisionInteraction: {
      findUnique: async ({ where }) => {
        const r = rows.find((x) => x.interactionId === where.interactionId);
        return r ? { outcomePayload: r.outcomePayload } : null;
      },
      updateMany: async ({ where, data }) => {
        const r = rows.find((x) => x.interactionId === where.interactionId);
        if (!r) return { count: 0 };
        r.outcomePayload = data.outcomePayload;
        return { count: 1 };
      },
      findMany: async ({ take }) => rows.slice(0, take).map((r) => ({ ...r })),
    },
  };
}

describe("recordGoldenTriangleReceipt", () => {
  it("merges the receipt onto outcomePayload, preserving other keys", async () => {
    const rows: Row[] = [{ interactionId: "i1", outcomePayload: { existing: 7 }, createdAt: new Date(), routeContext: null }];
    const ok = await recordGoldenTriangleReceipt("i1", receipt("opus"), fakeClient(rows));
    expect(ok).toBe(true);
    const payload = rows[0].outcomePayload as Record<string, unknown>;
    expect(payload.existing).toBe(7);
    expect((payload.goldenTriangleReceipt as GoldenTriangleReceipt).summary).toBe("summary-opus");
  });

  it("returns false when the interaction does not exist", async () => {
    expect(await recordGoldenTriangleReceipt("nope", receipt("x"), fakeClient([]))).toBe(false);
  });

  it("is fail-open when the client throws", async () => {
    const throwing: ReceiptStoreClient = {
      decisionInteraction: {
        findUnique: async () => {
          throw new Error("db down");
        },
        updateMany: async () => ({ count: 0 }),
        findMany: async () => [],
      },
    };
    expect(await recordGoldenTriangleReceipt("i1", receipt("x"), throwing)).toBe(false);
  });
});

describe("listGoldenTriangleReceipts", () => {
  it("returns only rows carrying a receipt, newest first, capped at the limit", async () => {
    const rows: Row[] = [
      { interactionId: "a", outcomePayload: { goldenTriangleReceipt: receipt("a") }, createdAt: new Date(3000), routeContext: "build-studio" },
      { interactionId: "b", outcomePayload: { other: 1 }, createdAt: new Date(2000), routeContext: null },
      { interactionId: "c", outcomePayload: { goldenTriangleReceipt: receipt("c") }, createdAt: new Date(1000), routeContext: "marketing" },
    ];
    const out = await listGoldenTriangleReceipts(2, fakeClient(rows));
    expect(out.map((r) => r.interactionId)).toEqual(["a", "c"]);
    expect(out[0].routeContext).toBe("build-studio");
    expect(out[0].receipt.summary).toBe("summary-a");
    expect(typeof out[0].at).toBe("string");
  });

  it("is fail-open, returning [] when the client throws", async () => {
    const throwing: ReceiptStoreClient = {
      decisionInteraction: {
        findUnique: async () => null,
        updateMany: async () => ({ count: 0 }),
        findMany: async () => {
          throw new Error("db down");
        },
      },
    };
    expect(await listGoldenTriangleReceipts(10, throwing)).toEqual([]);
  });
});
