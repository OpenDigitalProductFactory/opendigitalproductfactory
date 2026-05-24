// apps/web/lib/gear-interface/emit-ring-1-2.test.ts
//
// Integration-style tests for the Ring 1→2 emit path. Mocks @dpf/db so the
// suite runs without a live DB, and validates the producer → adapter → writer
// chain end-to-end across a few fixture outcomes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildPhaseFixture } from "./test-fixtures";

const gearRows = new Map<string, Record<string, unknown>>();
let nextId = 1;

const buildFromFixture = (outcome: "clean" | "abandoned" | "ux-failed" | "with-retries") =>
  buildPhaseFixture({ outcome });

let currentFixture = buildFromFixture("clean");

vi.mock("@dpf/db", () => ({
  prisma: {
    buildPhaseRun: {
      findUnique: vi.fn(async () => ({
        ...currentFixture.phaseRun,
        // Decimal stand-in: emit-ring-1-2 calls .toString() on costUsd
        costUsd: { toString: () => currentFixture.phaseRun.costUsd },
      })),
    },
    featureBuild: {
      findUnique: vi.fn(async () => ({
        claimedByAgentId: currentFixture.signals.claimedByAgentId,
        codingProvider: currentFixture.signals.codingProvider,
        uxVerificationStatus: currentFixture.signals.uxVerificationStatus,
        acceptanceMet:
          currentFixture.signals.acceptanceMet === true
            ? { met: true }
            : currentFixture.signals.acceptanceMet === false
              ? { met: false }
              : null,
        abandonedAt: currentFixture.signals.abandoned
          ? new Date(currentFixture.phaseRun.completedAt!.getTime() - 1000)
          : null,
        abandonReason: currentFixture.signals.abandonReason,
      })),
    },
    buildDispatchAttempt: {
      findMany: vi.fn(async () => {
        const failed = currentFixture.signals.worstFailureAxis
          ? [{ failureAxis: currentFixture.signals.worstFailureAxis, success: false }]
          : [];
        const extras = Array.from({
          length: currentFixture.signals.attemptCount - failed.length,
        }).map(() => ({ failureAxis: "unknown", success: true }));
        return [...failed, ...extras];
      }),
    },
    gearInterface: {
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => {
        return gearRows.get(where.idempotencyKey) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `gear-${nextId++}`,
          schemaVersion: 1,
          recordedAt: new Date(),
          slipDetected: false,
          ...data,
        };
        gearRows.set(String(data.idempotencyKey), row);
        return row;
      }),
    },
  },
  Prisma: {},
}));

import { emitRing12FromCompletedPhase } from "./emit-ring-1-2";
import { prisma } from "@dpf/db";

beforeEach(() => {
  gearRows.clear();
  nextId = 1;
  vi.clearAllMocks();
  currentFixture = buildFromFixture("clean");
});

describe("emitRing12FromCompletedPhase", () => {
  it("emits one Ring 1→2 transmission for a cleanly-completed phase", async () => {
    currentFixture = buildFromFixture("clean");
    await emitRing12FromCompletedPhase(currentFixture.buildId, currentFixture.phase);

    expect(prisma.gearInterface.create).toHaveBeenCalledOnce();
    const call = vi.mocked(prisma.gearInterface.create).mock.calls[0]![0];
    const data = call.data as Record<string, unknown>;
    expect(data.innerRing).toBe(1);
    expect(data.outerRing).toBe(2);
    expect(data.outcomeType).toBe("transmission");
    expect(data.torqueTechnical).toBe(1.0);
    expect(data.shaftSourceType).toBe("phase-run");
    expect(data.archetypeContext).toBeNull();
  });

  it("emits a slip with torque=0 when the build was abandoned", async () => {
    currentFixture = buildFromFixture("abandoned");
    await emitRing12FromCompletedPhase(currentFixture.buildId, currentFixture.phase);

    const data = (vi.mocked(prisma.gearInterface.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.outcomeType).toBe("slip");
    expect(data.torqueTechnical).toBe(0);
    expect(data.rationale).toContain("operator-veto");
  });

  it("emits a slip when UX verification failed", async () => {
    currentFixture = buildFromFixture("ux-failed");
    await emitRing12FromCompletedPhase(currentFixture.buildId, currentFixture.phase);
    const data = (vi.mocked(prisma.gearInterface.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.outcomeType).toBe("slip");
    expect(data.torqueTechnical).toBe(0);
  });

  it("records a slip-with-retries as partial torque + rate-limit reason", async () => {
    currentFixture = buildFromFixture("with-retries");
    await emitRing12FromCompletedPhase(currentFixture.buildId, currentFixture.phase);
    const data = (vi.mocked(prisma.gearInterface.create).mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.outcomeType).toBe("slip");
    expect(data.slipReason).toBe("rate-limit");
    expect(Number(data.torqueTechnical)).toBeGreaterThan(0);
    expect(Number(data.torqueTechnical)).toBeLessThan(1);
  });

  it("is idempotent — second call with same phase does NOT create a new row", async () => {
    currentFixture = buildFromFixture("clean");
    await emitRing12FromCompletedPhase(currentFixture.buildId, currentFixture.phase);
    await emitRing12FromCompletedPhase(currentFixture.buildId, currentFixture.phase);
    expect(prisma.gearInterface.create).toHaveBeenCalledOnce();
    expect(gearRows.size).toBe(1);
  });
});
