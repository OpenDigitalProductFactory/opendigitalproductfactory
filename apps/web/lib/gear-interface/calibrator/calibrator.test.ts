// apps/web/lib/gear-interface/calibrator/calibrator.test.ts
//
// Integration-style tests for getTrustForTriple — verifies the DB-read path
// shapes the query correctly and fails closed on errors.

import { describe, it, expect, vi, beforeEach } from "vitest";

const gearRowsByKey = new Map<string, Array<Record<string, unknown>>>();

function setRowsForKey(keyJSON: string, rows: Array<Record<string, unknown>>) {
  gearRowsByKey.set(keyJSON, rows);
}

vi.mock("@dpf/db", () => ({
  prisma: {
    gearInterface: {
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) => {
        // Build the lookup key from the where clause so tests can pre-load the result set.
        const lookup = JSON.stringify({
          agentIdForTriple: where.agentIdForTriple,
          capabilityName: where.capabilityName,
          archetypeContext: where.archetypeContext,
          interfaceClass: where.interfaceClass,
          innerRing: where.innerRing,
          outerRing: where.outerRing,
        });
        const rows = gearRowsByKey.get(lookup) ?? [];
        return rows.slice(0, take);
      }),
    },
  },
  Prisma: {},
}));

import { getTrustForTriple } from "./index";
import type { CalibrationKey } from "./types";

const KEY: CalibrationKey = {
  agentIdForTriple: "agent-build-specialist",
  capabilityName: "build-phase-build",
  archetypeContext: null,
  interfaceClass: "internal-adjacent",
  innerRing: 1,
  outerRing: 2,
  autonomyLevel: "hitl-required",
};

const KEY_LOOKUP = JSON.stringify({
  agentIdForTriple: KEY.agentIdForTriple,
  capabilityName: KEY.capabilityName,
  archetypeContext: KEY.archetypeContext,
  interfaceClass: KEY.interfaceClass,
  innerRing: KEY.innerRing,
  outerRing: KEY.outerRing,
});

beforeEach(() => {
  gearRowsByKey.clear();
  vi.clearAllMocks();
});

describe("getTrustForTriple", () => {
  it("returns the empty fail-closed reading when no rows match the key", async () => {
    const t = await getTrustForTriple(KEY);
    expect(t.score).toBeNull();
    expect(t.sampleSize).toBe(0);
    expect(t.confidence).toBe(0);
  });

  it("aggregates the rows that match the key", async () => {
    setRowsForKey(KEY_LOOKUP, [
      { torqueTechnical: 1, graderType: "automated", recordedAt: new Date("2026-05-24T15:00:00Z") },
      { torqueTechnical: 1, graderType: "automated", recordedAt: new Date("2026-05-24T14:00:00Z") },
      { torqueTechnical: 0.5, graderType: "automated", recordedAt: new Date("2026-05-24T13:00:00Z") },
    ]);
    const t = await getTrustForTriple(KEY);
    expect(t.score).toBeCloseTo((1 + 1 + 0.5) / 3, 6);
    expect(t.sampleSize).toBe(3);
    expect(t.recentFailureCount).toBe(0);
  });

  it("does NOT cross archetype contexts — null context stays null", async () => {
    // Same agent + capability, but with archetypeContext='hvac'. Should NOT match KEY (archetype=null).
    const hvacLookup = JSON.stringify({
      ...JSON.parse(KEY_LOOKUP),
      archetypeContext: "hvac",
    });
    setRowsForKey(hvacLookup, [
      { torqueTechnical: 1, graderType: "human", recordedAt: new Date() },
    ]);
    const t = await getTrustForTriple(KEY);
    expect(t.sampleSize).toBe(0);
    expect(t.score).toBeNull();
  });

  it("limits the read to rollingWindow rows", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      torqueTechnical: 1,
      graderType: "automated",
      recordedAt: new Date(2026, 4, 24, i),
    }));
    setRowsForKey(KEY_LOOKUP, rows);
    const t = await getTrustForTriple(KEY, { rollingWindow: 15 });
    expect(t.sampleSize).toBe(15);
  });

  it("returns the empty reading when prisma throws", async () => {
    const { prisma } = await import("@dpf/db");
    vi.mocked(prisma.gearInterface.findMany).mockRejectedValueOnce(new Error("connection lost"));
    const t = await getTrustForTriple(KEY);
    expect(t.score).toBeNull();
    expect(t.sampleSize).toBe(0);
  });
});
