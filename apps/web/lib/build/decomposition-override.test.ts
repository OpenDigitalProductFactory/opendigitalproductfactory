// apps/web/lib/build/decomposition-override.test.ts
//
// Coverage for Phase 4a operator override on required-tier decomposition.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md §12 Q1
// BI: BI-2E6CC391.

import { describe, expect, it, vi } from "vitest";

import { recordDecompositionOverride, type RecordDecompositionOverrideDb } from "./decomposition-override";

function makeReview(decision: "ok" | "decompose-recommended" | "decompose-required" | null) {
  return {
    decision: "pass" as const,
    issues: [],
    summary: "ok",
    ...(decision
      ? {
          sizeAssessment: {
            decision,
            breakdown: {
              models: { count: 5, samples: [] },
              endpoints: { count: 2, samples: [] },
              acs: { count: 25 },
              multipliers: { count: 4, matchedKeywords: [] },
              routes: { count: 2, samples: [] },
            },
            trips: [],
            rationale: "test",
            thresholds: {
              models: { recommend: 3, required: 5 },
              endpoints: { recommend: 4, required: 7 },
              acs: { recommend: 12, required: 20 },
              multipliers: { recommend: 2, required: 4 },
              routes: { recommend: 2, required: 4 },
            },
            assessedAt: "2026-05-24T20:00:00.000Z",
          },
        }
      : {}),
  };
}

function makeFakeDb(designReview: unknown, buildExists = true): {
  db: RecordDecompositionOverrideDb;
  writes: {
    updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
    activities: Array<Record<string, unknown>>;
    backlogActivities: Array<Record<string, unknown>>;
    transactions: number;
  };
} {
  const writes = {
    updates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
    activities: [] as Array<Record<string, unknown>>,
    backlogActivities: [] as Array<Record<string, unknown>>,
    transactions: 0,
  };
  const db: RecordDecompositionOverrideDb = {
    $transaction: vi.fn(async (fn) => {
      writes.transactions += 1;
      return fn(db);
    }) as RecordDecompositionOverrideDb["$transaction"],
    featureBuild: {
      findUnique: vi.fn(async () =>
        buildExists
          ? ({ buildId: "FB-DALE", designReview, originatingBacklogItemId: "bi-parent-row" } as never)
          : null,
      ) as unknown as RecordDecompositionOverrideDb["featureBuild"]["findUnique"],
      update: vi.fn(async (args) => {
        writes.updates.push(args as never);
        return null as never;
      }) as unknown as RecordDecompositionOverrideDb["featureBuild"]["update"],
    },
    buildActivity: {
      create: vi.fn(async ({ data }) => {
        writes.activities.push(data as never);
        return null as never;
      }) as unknown as RecordDecompositionOverrideDb["buildActivity"]["create"],
    },
    backlogItemActivity: {
      create: vi.fn(async ({ data }) => {
        writes.backlogActivities.push(data as never);
        return { id: "coverage-receipt-atomic" } as never;
      }) as unknown as RecordDecompositionOverrideDb["backlogItemActivity"]["create"],
    },
  };
  return { db, writes };
}

const fixedNow = () => new Date("2026-05-24T20:00:00.000Z");

describe("recordDecompositionOverride — success path", () => {
  it("records override on a required-tier build", async () => {
    const { db, writes } = makeFakeDb(makeReview("decompose-required"));
    const result = await recordDecompositionOverride({
      buildId: "FB-DALE",
      rationale: "Single tech ships this end-to-end; splitting adds coordination cost.",
      userId: "user-1",
      agentId: "agent-9",
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.override.rationale).toMatch(/Single tech/);
    expect(result.override.recordedAt).toBe("2026-05-24T20:00:00.000Z");
    expect(result.override.recordedByUserId).toBe("user-1");
    expect(result.override.recordedByAgentId).toBe("agent-9");

    // Persisted shape on designReview.
    expect(writes.updates).toHaveLength(1);
    const updatedReview = writes.updates[0]!.data.designReview as {
      decompositionOverride: { rationale: string };
    };
    expect(updatedReview.decompositionOverride.rationale).toMatch(/Single tech/);

    // Activity row.
    expect(writes.activities).toHaveLength(1);
    expect(writes.transactions).toBe(1);
    expect(writes.activities[0]!.tool).toBe("recordDecompositionOverride");
    expect(writes.backlogActivities).toHaveLength(1);
    expect(writes.backlogActivities[0]).toMatchObject({
      backlogItemId: "bi-parent-row",
      kind: "plan_backlog_coverage",
      payload: {
        decision: "atomic",
        rationale: "Single tech ships this end-to-end; splitting adds coordination cost.",
        sourceBuildId: "FB-DALE",
      },
    });
  });

  it("defaults recordedByAgentId to null when no agentId supplied", async () => {
    const { db } = makeFakeDb(makeReview("decompose-required"));
    const result = await recordDecompositionOverride({
      buildId: "FB-DALE",
      rationale: "Operator override.",
      userId: "user-1",
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.override.recordedByAgentId).toBeNull();
  });
});

describe("recordDecompositionOverride — failure paths", () => {
  it("rejects empty rationale", async () => {
    const { db } = makeFakeDb(makeReview("decompose-required"));
    const result = await recordDecompositionOverride({
      buildId: "FB-DALE",
      rationale: "   ",
      userId: "user-1",
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("empty-rationale");
  });

  it("rejects when build does not exist", async () => {
    const { db } = makeFakeDb(makeReview("decompose-required"), /*buildExists*/ false);
    const result = await recordDecompositionOverride({
      buildId: "FB-MISSING",
      rationale: "ok",
      userId: "user-1",
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("build-not-found");
  });

  it("rejects when no size assessment is recorded", async () => {
    // designReview present but no sizeAssessment field.
    const { db } = makeFakeDb({ decision: "pass", issues: [], summary: "pre-Phase-2 build" });
    const result = await recordDecompositionOverride({
      buildId: "FB-DALE",
      rationale: "ok",
      userId: "user-1",
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("no-size-assessment");
  });

  it("rejects on recommended-tier (single-click path, no override needed)", async () => {
    const { db } = makeFakeDb(makeReview("decompose-recommended"));
    const result = await recordDecompositionOverride({
      buildId: "FB-DALE",
      rationale: "ok",
      userId: "user-1",
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("override-not-applicable");
  });

  it("rejects on ok-tier (no decomposition needed)", async () => {
    const { db } = makeFakeDb(makeReview("ok"));
    const result = await recordDecompositionOverride({
      buildId: "FB-DALE",
      rationale: "ok",
      userId: "user-1",
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("override-not-applicable");
  });
});
