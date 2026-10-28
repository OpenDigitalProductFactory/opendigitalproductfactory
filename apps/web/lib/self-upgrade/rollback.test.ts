import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    selfUpgradeRun: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    backupRun: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/operate/metrics", () => ({
  postgresRestoreRunsTotal: { inc: vi.fn() },
  postgresRestoreDurationSeconds: { observe: vi.fn() },
}));

import { prisma } from "@dpf/db";
import { __test__ as restoreLockTest } from "@/lib/operate/backups/postgres-restore-runner";
import * as restoreRunner from "@/lib/operate/backups/postgres-restore-runner";
import { getSelfUpgradeRecoveryState } from "./recovery-eligibility";
import {
  hasGovernedRecoveryPoint,
  runSelfUpgradeRollback,
  SelfUpgradeRollbackError,
} from "./rollback";

const mockPrisma = prisma as unknown as {
  selfUpgradeRun: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  backupRun: {
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};
const acquireRestoreLock = vi.spyOn(restoreRunner, "acquireRestoreLock");

const recoveryPoint = {
  schemaVersion: 1,
  status: "ok",
  trigger: "pre-upgrade-recovery",
  selfUpgradeRunId: "SUR-ROLLBACK",
  createdAt: "2026-06-01T00:00:00.000Z",
  // Postgres is the only restore target (BET-5).
  members: [{ target: "postgres", runId: "BR-PG", status: "ok" }],
};

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: "SUR-ROLLBACK",
    trigger: "manual:user-ops",
    status: "succeeded",
    currentSha: "before-sha",
    targetSha: "after-sha",
    deployedSha: "after-sha",
    startedAt: new Date("2026-06-01T00:01:00.000Z"),
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    completionEvidence: { recoveryPoint },
    failureLog: null,
    ...overrides,
  };
}

function makeBackupRun(id: string, target: string) {
  return {
    id,
    target,
    startedAt: new Date("2026-06-01T00:00:00.000Z"),
    finishedAt: new Date("2026-06-01T00:00:10.000Z"),
    status: "ok",
    trigger: "pre-upgrade-recovery",
    schedule: null,
    sizeBytes: null,
    durationMs: 10_000,
    sha256: `sha-${id}`,
    pgVersion: target === "postgres" ? "16" : null,
    dpfVersion: "before-sha",
    storagePath: `${target}/${id}`,
    errorMessage: null,
    prunedAt: null,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
  };
}

function mockRecoveryBackupRuns() {
  mockPrisma.backupRun.findMany.mockResolvedValue([
    makeBackupRun("BR-PG", "postgres"),
  ]);
}

describe("self-upgrade rollback", () => {
  beforeEach(() => {
    restoreLockTest.resetLockForTest();
    vi.clearAllMocks();
    mockPrisma.selfUpgradeRun.findUnique.mockResolvedValue(makeRun());
    mockPrisma.selfUpgradeRun.upsert.mockResolvedValue({});
    mockPrisma.backupRun.upsert.mockResolvedValue({});
    mockRecoveryBackupRuns();
  });

  it("rejects missing self-upgrade runs", async () => {
    mockPrisma.selfUpgradeRun.findUnique.mockResolvedValue(null);

    await expect(
      runSelfUpgradeRollback({
        runId: "SUR-MISSING",
        prismaClient: mockPrisma as never,
      }),
    ).rejects.toThrow(SelfUpgradeRollbackError);
    expect(mockPrisma.backupRun.findMany).not.toHaveBeenCalled();
  });

  it("rejects runs without governed recovery-point evidence", async () => {
    mockPrisma.selfUpgradeRun.findUnique.mockResolvedValue(
      makeRun({ completionEvidence: {} }),
    );

    await expect(
      runSelfUpgradeRollback({
        runId: "SUR-NO-POINT",
        prismaClient: mockPrisma as never,
      }),
    ).rejects.toThrow(/no governed recovery point/i);
  });

  it("rejects incomplete recovery points before restoring anything", async () => {
    mockPrisma.selfUpgradeRun.findUnique.mockResolvedValue(
      makeRun({
        completionEvidence: {
          recoveryPoint: {
            ...recoveryPoint,
            members: recoveryPoint.members.filter((member) => member.target !== "postgres"),
          },
        },
      }),
    );
    const postgres = vi.fn();

    await expect(
      runSelfUpgradeRollback({
        runId: "SUR-INCOMPLETE",
        prismaClient: mockPrisma as never,
        runners: { postgres },
      }),
    ).rejects.toThrow(/missing successful backup members: postgres/i);
    expect(postgres).not.toHaveBeenCalled();
  });

  it.each(["missing", "empty-active-tasks", "retired", "forged-retention"])(
    "refuses canonical restoration with %s proof before any restore effect", async proof => {
      const evidence = { recoveryPoint, reassessmentRetention: {
        proof, activeTaskIds: [], capabilitiesRetired: true, allocationsRetained: true,
      } };
      mockPrisma.selfUpgradeRun.findUnique.mockResolvedValue(makeRun({ completionEvidence: evidence }));
      const postgres = vi.fn(async () => ({ restoreId: "RR-PG", status: "ok" as const }));
      await expect(runSelfUpgradeRollback({ runId: "SUR-ROLLBACK", prismaClient: mockPrisma as never,
        runners: { postgres } })).rejects.toThrow(/reassessment.*retention.*unproven/i);
      expect(postgres).not.toHaveBeenCalled();
      expect(mockPrisma.backupRun.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.backupRun.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.selfUpgradeRun.upsert).not.toHaveBeenCalled();
      expect(evidence).toEqual({ recoveryPoint, reassessmentRetention: {
        proof, activeTaskIds: [], capabilitiesRetired: true, allocationsRetained: true,
      } });
    },
  );

  it("does not launch even a refusing restore runner or relabel the upgrade as rolled back", async () => {
    const postgres = vi.fn().mockRejectedValue(new Error("pg_restore failed"));
    await expect(runSelfUpgradeRollback({
      runId: "SUR-ROLLBACK",
      prismaClient: mockPrisma as never,
      runners: { postgres },
    })).rejects.toThrow(/reassessment-rollback-retention-unproven/);
    expect(postgres).not.toHaveBeenCalled();
    expect(mockPrisma.selfUpgradeRun.upsert).not.toHaveBeenCalled();
  });

  it("refuses concurrent callers without a restore process or history writes", async () => {
    const postgres = vi.fn(async () => ({ restoreId: "RR-PG", status: "ok" as const }));
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => runSelfUpgradeRollback({
      runId: "SUR-ROLLBACK", prismaClient: mockPrisma as never, runners: { postgres },
    })));
    expect(results.every(result => result.status === "rejected"
      && result.reason instanceof SelfUpgradeRollbackError)).toBe(true);
    expect(postgres).not.toHaveBeenCalled();
    expect(mockPrisma.backupRun.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.selfUpgradeRun.upsert).not.toHaveBeenCalled();
  });

  it("recognizes recovery-point structure without admitting restoration", () => {
    expect(hasGovernedRecoveryPoint({ recoveryPoint })).toBe(true);
    expect(hasGovernedRecoveryPoint({ recoveryPoint: { ...recoveryPoint, status: "failed" } })).toBe(false);
    expect(hasGovernedRecoveryPoint({})).toBe(false);
  });

  it.each([
    makeRun({ status: "running" }),
    makeRun({ completionEvidence: null }),
    makeRun({ completionEvidence: { recoveryPoint: { ...recoveryPoint, members: [null] } } }),
    makeRun({ completionEvidence: { recoveryPoint: { ...recoveryPoint, status: "failed" } } }),
    makeRun({ completionEvidence: { recoveryPoint, rollback: { status: "ok" } } }),
    makeRun(),
  ])("uses the same fresh-run policy before any restore effect: %j", async run => {
    mockPrisma.selfUpgradeRun.findUnique.mockResolvedValue(run);
    const expected = getSelfUpgradeRecoveryState(run);
    const postgres = vi.fn();
    await expect(runSelfUpgradeRollback({ runId: "SUR-ROLLBACK", prismaClient: mockPrisma as never,
      runners: { postgres } })).rejects.toThrow(`${expected.reason}: ${expected.detail}`);
    expect(mockPrisma.selfUpgradeRun.findUnique).toHaveBeenCalledTimes(1);
    expect(mockPrisma.backupRun.findMany).not.toHaveBeenCalled();
    expect(acquireRestoreLock).not.toHaveBeenCalled();
    expect(postgres).not.toHaveBeenCalled();
    expect(mockPrisma.backupRun.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.selfUpgradeRun.upsert).not.toHaveBeenCalled();
  });
});
