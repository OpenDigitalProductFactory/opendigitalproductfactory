import { describe, expect, it } from "vitest";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import { compileGoldenTrianglePolicy } from "./compile";
import {
  listRecentPostureReceipts,
  receiptFromTelemetry,
  type TelemetryReceiptClient,
  type TelemetryRunRow,
} from "./telemetry-receipts";

const ASSURED: GoldenTrianglePreference = { preset: "assured", qualityWeight: 0.8, costWeight: 0.1, timeWeight: 0.1 };
const decoded = compileGoldenTrianglePolicy({ preference: ASSURED, taskClass: "conversation", authorityScope: { kind: "wwmd" } });

function row(over: Partial<TelemetryRunRow> = {}): TelemetryRunRow {
  return {
    id: "t1",
    modelId: "claude-opus-4-7",
    estimatedCostUsd: 0.12,
    durationMs: 14000,
    userAccepted: true,
    startedAt: new Date("2026-06-23T10:00:00.000Z"),
    ...over,
  };
}

describe("receiptFromTelemetry", () => {
  it("maps a telemetry row to a receipt measured against the posture", () => {
    const r = receiptFromTelemetry(row(), ASSURED, decoded);
    expect(r.interactionId).toBe("t1");
    expect(r.receipt.actual.modelId).toBe("claude-opus-4-7");
    expect(r.receipt.actual.costUsd).toBe(0.12);
    expect(r.receipt.actual.tier).toBe("frontier");
    expect(r.receipt.matchedRequest).toBe(true);
    expect(typeof r.at).toBe("string");
  });

  it("coerces a Decimal-like cost and tolerates a null cost", () => {
    expect(receiptFromTelemetry(row({ estimatedCostUsd: { toString: () => "0.05" } }), ASSURED, decoded).receipt.actual.costUsd).toBe(0.05);
    expect(receiptFromTelemetry(row({ estimatedCostUsd: null }), ASSURED, decoded).receipt.actual.costUsd).toBeNull();
  });
});

describe("listRecentPostureReceipts", () => {
  function client(platform: GoldenTrianglePreference | null, rows: TelemetryRunRow[]): TelemetryReceiptClient {
    return {
      decisionPerspectiveProfile: {
        findFirst: async () => (platform ? { autonomyPolicy: { goldenTriangle: platform } } : null),
        updateMany: async () => ({ count: 0 }),
      },
      adapterRunTelemetry: { findMany: async () => rows },
    };
  }

  it("reconstructs receipts for the active posture, preserving row order", async () => {
    const out = await listRecentPostureReceipts(10, client(ASSURED, [row({ id: "a" }), row({ id: "b", modelId: "gpt-4o-mini" })]));
    expect(out.map((r) => r.interactionId)).toEqual(["a", "b"]);
    expect(out[0].receipt.matchedRequest).toBe(true); // opus meets frontier
    expect(out[1].receipt.matchedRequest).toBe(false); // gpt-4o-mini is below frontier
  });

  it("returns [] when no posture is set (nothing to compare against)", async () => {
    expect(await listRecentPostureReceipts(10, client(null, [row()]))).toEqual([]);
  });

  it("is fail-open: returns [] when the telemetry query throws", async () => {
    const throwing: TelemetryReceiptClient = {
      decisionPerspectiveProfile: {
        findFirst: async () => ({ autonomyPolicy: { goldenTriangle: ASSURED } }),
        updateMany: async () => ({ count: 0 }),
      },
      adapterRunTelemetry: {
        findMany: async () => {
          throw new Error("db down");
        },
      },
    };
    expect(await listRecentPostureReceipts(10, throwing)).toEqual([]);
  });
});
