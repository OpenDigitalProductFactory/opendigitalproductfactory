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

const recoveryPoint = {
  schemaVersion: 1,
  status: "ok",
  trigger: "pre-upgrade-recovery",
  selfUpgradeRunId: "SUR-ROLLBACK",
  createdAt: "2026-06-01T00:00:00.000Z",
  members: [
    { target: "postgres", runId: "BR-PG", status: "ok" },
    { target: "neo4j", runId: "BR-N4J", status: "ok" },
    { target: "qdrant", runId: "BR-QD", status: "ok" },
  ],
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
    makeBackupRun("BR-N4J", "neo4j"),
    makeBackupRun("BR-QD", "qdrant"),
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
            members: recoveryPoint.members.filter((member) => member.target !== "qdrant"),
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
    ).rejects.toThrow(/missing successful backup members: qdrant/i);
    expect(postgres).not.toHaveBeenCalled();
  });

  it("restores postgres, neo4j, then qdrant from the recovery point", async () => {
    const calls: string[] = [];
    const now = vi
      .fn()
      .mockReturnValueOnce(new Date("2026-06-01T00:10:00.000Z"))
      .mockReturnValueOnce(new Date("2026-06-01T00:15:00.000Z"));
    const postgres = vi.fn(async (args) => {
      calls.push("postgres");
      expect(args).toMatchObject({
        sourceBackupRunId: "BR-PG",
        initiatedByUserId: "user-ops",
        trigger: "self-upgrade-rollback",
        acquireLock: false,
      });
      expect(args.prismaClient).toBe(mockPrisma);
      return { restoreId: "RR-PG", status: "ok" as const };
    });
    const neo4j = vi.fn(async (args) => {
      calls.push("neo4j");
      expect(args).toMatchObject({
        sourceBackupRunId: "BR-N4J",
        trigger: "self-upgrade-rollback",
        acquireLock: false,
      });
      expect(args.prismaClient).toBe(mockPrisma);
      return { restoreId: "RR-N4J", status: "ok" as const };
    });
    const qdrant = vi.fn(async (args) => {
      calls.push("qdrant");
      expect(args).toMatchObject({
        sourceBackupRunId: "BR-QD",
        trigger: "self-upgrade-rollback",
        acquireLock: false,
      });
      expect(args.prismaClient).toBe(mockPrisma);
      return { restoreId: "RR-QD", status: "ok" as const };
    });

    const result = await runSelfUpgradeRollback({
      runId: "SUR-ROLLBACK",
      initiatedByUserId: "user-ops",
      prismaClient: mockPrisma as never,
      now,
      runners: { postgres, neo4j, qdrant },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "ok",
      runId: "SUR-ROLLBACK",
      restores: [
        { target: "postgres", sourceBackupRunId: "BR-PG", restoreId: "RR-PG", status: "ok" },
        { target: "neo4j", sourceBackupRunId: "BR-N4J", restoreId: "RR-N4J", status: "ok" },
        { target: "qdrant", sourceBackupRunId: "BR-QD", restoreId: "RR-QD", status: "ok" },
      ],
    });
    expect(calls).toEqual(["postgres", "neo4j", "qdrant"]);
    expect(mockPrisma.backupRun.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["BR-PG", "BR-N4J", "BR-QD"] } },
    });
    expect(mockPrisma.backupRun.upsert).toHaveBeenCalledTimes(3);
    expect(mockPrisma.backupRun.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: "BR-PG" } }),
    );
    expect(mockPrisma.selfUpgradeRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: "SUR-ROLLBACK" },
        update: expect.objectContaining({
          status: "rolled-back",
          failureLog: null,
        }),
      }),
    );
    const upsertCall = mockPrisma.selfUpgradeRun.upsert.mock.calls[0][0];
    expect(upsertCall.update.completionEvidence.rollback).toMatchObject({
      schemaVersion: 1,
      trigger: "self-upgrade-rollback",
      status: "ok",
      selfUpgradeRunId: "SUR-ROLLBACK",
      restoreOrder: ["postgres", "neo4j", "qdrant"],
    });
  });

  it("stops after a failed member restore and records rollback-failed evidence", async () => {
    const postgres = vi.fn().mockResolvedValue({ restoreId: "RR-PG", status: "ok" });
    const neo4j = vi.fn().mockRejectedValue(new Error("neo4j volume missing"));
    const qdrant = vi.fn().mockResolvedValue({ restoreId: "RR-QD", status: "ok" });

    const result = await runSelfUpgradeRollback({
      runId: "SUR-ROLLBACK",
      prismaClient: mockPrisma as never,
      runners: { postgres, neo4j, qdrant },
    });

    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      error: "self-upgrade rollback failed at neo4j: neo4j volume missing",
    });
    expect(postgres).toHaveBeenCalledTimes(1);
    expect(neo4j).toHaveBeenCalledTimes(1);
    expect(qdrant).not.toHaveBeenCalled();
    expect(mockPrisma.backupRun.upsert).toHaveBeenCalledTimes(3);
    expect(mockPrisma.selfUpgradeRun.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          status: "rollback-failed",
          failureLog: "self-upgrade rollback failed at neo4j: neo4j volume missing",
        }),
      }),
    );
  });

  it("reports whether completion evidence contains a restorable recovery point", () => {
    expect(hasGovernedRecoveryPoint({ recoveryPoint })).toBe(true);
    expect(hasGovernedRecoveryPoint({ recoveryPoint: { ...recoveryPoint, status: "failed" } })).toBe(false);
    expect(hasGovernedRecoveryPoint({})).toBe(false);
  });
});
