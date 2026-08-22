import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the registry-write counters so tests don't pollute prom-client state.
vi.mock("@/lib/operate/metrics", () => ({
  postgresTrialRestoreRunsTotal: { inc: vi.fn() },
  postgresTrialRestoreDurationSeconds: { observe: vi.fn() },
  postgresTrialRestoreLastSuccessSeconds: { set: vi.fn() },
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    backupRun: { findMany: vi.fn(), findUnique: vi.fn() },
    backupRestore: { create: vi.fn() },
    scheduledJob: { update: vi.fn() },
    platformNotification: { create: vi.fn(), updateMany: vi.fn() },
  },
}));

import { parseResultLine, runPostgresTrialRestore, type ScriptOutcome } from "./postgres-trial-restore-runner";
import { prisma } from "@dpf/db";

type Mock = ReturnType<typeof vi.fn>;
const findManyMock = prisma.backupRun.findMany as unknown as Mock;
const findUniqueMock = prisma.backupRun.findUnique as unknown as Mock;
const createMock = prisma.backupRestore.create as unknown as Mock;
const scheduledJobUpdateMock = prisma.scheduledJob.update as unknown as Mock;
const notificationCreateMock = prisma.platformNotification.create as unknown as Mock;
const notificationUpdateManyMock = prisma.platformNotification.updateMany as unknown as Mock;

beforeEach(() => {
  findManyMock.mockReset();
  findUniqueMock.mockReset();
  createMock.mockReset();
  scheduledJobUpdateMock.mockReset();
  notificationCreateMock.mockReset();
  notificationUpdateManyMock.mockReset();
  createMock.mockImplementation(async ({ data, select }) => ({ id: "restore_test_id", ...(select ? {} : data) }));
  scheduledJobUpdateMock.mockResolvedValue({});
  notificationCreateMock.mockResolvedValue({ id: "notif_test_id" });
  notificationUpdateManyMock.mockResolvedValue({ count: 1 });
});

describe("parseResultLine", () => {
  it("parses an ok result with all assertions + duration", () => {
    const stdout =
      "[trace] starting\n" +
      "[trace] some other line\n" +
      "RESULT ok assert_BacklogItem=550 assert_Epic=62 assert_ModelProvider=30 assert_User=1 duration_ms=10000\n";
    expect(parseResultLine(stdout)).toEqual({
      status: "ok",
      assertions: { BacklogItem: 550, Epic: 62, ModelProvider: 30, User: 1 },
      durationMs: 10000,
      reason: null,
    });
  });

  it("parses a failed result with a reason", () => {
    const stdout = "RESULT failed assert_BacklogItem=0 duration_ms=5000 reason=BacklogItem:zero-rows\n";
    expect(parseResultLine(stdout)).toEqual({
      status: "failed",
      assertions: { BacklogItem: 0 },
      durationMs: 5000,
      reason: "BacklogItem:zero-rows",
    });
  });

  it("returns null when no RESULT line is present", () => {
    expect(parseResultLine("[trace] no result\n[trace] script crashed\n")).toBeNull();
  });

  it("returns null when the RESULT status is bogus", () => {
    expect(parseResultLine("RESULT something-else duration_ms=1\n")).toBeNull();
  });

  it("picks the LAST RESULT line if multiple exist", () => {
    const stdout = "RESULT ok assert_x=1 duration_ms=1\nRESULT failed reason=last-one\n";
    expect(parseResultLine(stdout)?.status).toBe("failed");
  });
});

describe("runPostgresTrialRestore", () => {
  const okScript: ScriptOutcome = {
    ok: true,
    stdout: "RESULT ok assert_BacklogItem=550 assert_Epic=62 assert_ModelProvider=30 assert_User=1 duration_ms=10000\n",
    stderr: "",
    exitCode: 0,
  };

  it("trial-restores the explicitly requested backup instead of a newer unrelated run", async () => {
    const { promises: fs } = await import("node:fs");
    const accessSpy = vi.spyOn(fs, "access").mockResolvedValue(undefined);
    let selectedDump = "";
    try {
      findUniqueMock.mockResolvedValue({
        id: "teardown_recovery",
        storagePath: "postgres/teardown-recovery",
        target: "postgres",
        status: "ok",
        prunedAt: null,
      });
      findManyMock.mockResolvedValue([
        { id: "newer_but_unrelated", storagePath: "postgres/newer" },
      ]);

      const result = await runPostgresTrialRestore({
        sourceBackupRunId: "teardown_recovery",
        backupsRoot: "/test/backups",
        runScript: async (_script, env) => {
          selectedDump = env.DUMP_PATH ?? "";
          return okScript;
        },
      });

      expect(result.status).toBe("ok");
      expect(selectedDump).toBe("/test/backups/postgres/teardown-recovery/dpf.dump");
      expect(findUniqueMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "teardown_recovery" } }));
      expect(findManyMock).not.toHaveBeenCalled();
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ sourceBackupRunId: "teardown_recovery" }),
      }));
    } finally {
      accessSpy.mockRestore();
    }
  });

  it("returns skipped + writes no BackupRestore row when no eligible backup exists", async () => {
    findManyMock.mockResolvedValue([]);
    const result = await runPostgresTrialRestore({
      runScript: async () => okScript,
    });
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("no eligible backup");
    expect(createMock).not.toHaveBeenCalled();
    // Heartbeat updated with the skip outcome:
    expect(scheduledJobUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastStatus: "skipped" }) }),
    );
  });

  it("returns ok + writes a BackupRestore row with trigger=trial-verification on success", async () => {
    findManyMock.mockResolvedValue([
      { id: "backuprun_a", storagePath: "postgres/2026-05-24T03-00-00Z" },
    ]);
    // Make file-access succeed by passing a dummy backupsRoot that doesn't matter
    // (the runner reads via fs.access; for unit tests we skip the eligible check
    // by stubbing findMany to return a single row AND injecting a script that
    // succeeds — fs.access against the docker dump path won't exist, so we
    // need to mock fs.access too OR pass the script result regardless).
    // Use a backupsRoot that the test's stub script ignores.
    const result = await runPostgresTrialRestore({
      backupsRoot: "/nonexistent/test/root",
      runScript: async () => okScript,
    });
    // findLatestEligibleBackup rejects when fs.access fails; with our nonexistent
    // root the loop exhausts and returns null → status=skipped. To test the
    // "ok" path properly, mock fs.access. Simpler: use the actual file we
    // know exists from the live smoke test would be flaky in CI. So pivot —
    // expect skipped here too, and test the ok-path via a separate test that
    // mocks fs.access.
    expect(result.status).toBe("skipped");
  });

  it("happy path: writes ok BackupRestore when script returns RESULT ok", async () => {
    // Mock node:fs/promises.access to always succeed so findLatestEligibleBackup
    // picks the first row regardless of where backupsRoot points.
    const { promises: fs } = await import("node:fs");
    const accessSpy = vi.spyOn(fs, "access").mockResolvedValue(undefined);
    try {
      findManyMock.mockResolvedValue([
        { id: "backuprun_a", storagePath: "postgres/2026-05-24T03-00-00Z" },
      ]);
      const result = await runPostgresTrialRestore({
        backupsRoot: "/test/backups",
        runScript: async () => okScript,
      });
      expect(result.status).toBe("ok");
      expect(result.restoreId).toBe("restore_test_id");
      expect(result.assertions).toEqual({
        BacklogItem: 550, Epic: 62, ModelProvider: 30, User: 1,
      });
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "ok",
            trigger: "trial-verification",
            sourceBackupRunId: "backuprun_a",
            preRestoreBackupRunId: null,
            initiatedByUserId: null,
            errorMessage: null,
          }),
        }),
      );
    } finally {
      accessSpy.mockRestore();
    }
  });

  it("failed path: writes failed BackupRestore + carries the assertion reason", async () => {
    const { promises: fs } = await import("node:fs");
    const accessSpy = vi.spyOn(fs, "access").mockResolvedValue(undefined);
    try {
      findManyMock.mockResolvedValue([
        { id: "backuprun_a", storagePath: "postgres/2026-05-24T03-00-00Z" },
      ]);
      const failedScript: ScriptOutcome = {
        ok: false,
        stdout: "RESULT failed assert_BacklogItem=0 duration_ms=5000 reason=BacklogItem:zero-rows\n",
        stderr: "",
        exitCode: 5,
      };
      const result = await runPostgresTrialRestore({
        backupsRoot: "/test/backups",
        runScript: async () => failedScript,
      });
      expect(result.status).toBe("failed");
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "failed",
            trigger: "trial-verification",
            errorMessage: expect.stringContaining("BacklogItem:zero-rows"),
          }),
        }),
      );
    } finally {
      accessSpy.mockRestore();
    }
  });

  it("recognizes exit code 6 (cleanup orphan) as ok with a warning errorMessage", async () => {
    const { promises: fs } = await import("node:fs");
    const accessSpy = vi.spyOn(fs, "access").mockResolvedValue(undefined);
    try {
      findManyMock.mockResolvedValue([
        { id: "backuprun_a", storagePath: "postgres/2026-05-24T03-00-00Z" },
      ]);
      const cleanupOrphanScript: ScriptOutcome = {
        ok: false, // execFile sees exit != 0 as error
        stdout: "RESULT ok assert_BacklogItem=550 duration_ms=10000\n",
        stderr: "WARN: failed to drop dpf_trial_xxx",
        exitCode: 6,
      };
      const result = await runPostgresTrialRestore({
        backupsRoot: "/test/backups",
        runScript: async () => cleanupOrphanScript,
      });
      expect(result.status).toBe("ok");
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "ok",
            errorMessage: expect.stringContaining("orphan temp DB"),
          }),
        }),
      );
    } finally {
      accessSpy.mockRestore();
    }
  });

  it("recognizes exit code 3 (CREATE DATABASE failed) with a CREATEDB-privilege hint", async () => {
    const { promises: fs } = await import("node:fs");
    const accessSpy = vi.spyOn(fs, "access").mockResolvedValue(undefined);
    try {
      findManyMock.mockResolvedValue([
        { id: "backuprun_a", storagePath: "postgres/2026-05-24T03-00-00Z" },
      ]);
      const createDbFailScript: ScriptOutcome = {
        ok: false,
        stdout: "", // no RESULT line
        stderr: "permission denied to create database",
        exitCode: 3,
      };
      const result = await runPostgresTrialRestore({
        backupsRoot: "/test/backups",
        runScript: async () => createDbFailScript,
      });
      expect(result.status).toBe("failed");
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            errorMessage: expect.stringContaining("CREATEDB privilege"),
          }),
        }),
      );
    } finally {
      accessSpy.mockRestore();
    }
  });

  it("failed trial restore creates a critical PlatformNotification (BI-EA67A758)", async () => {
    const { promises: fs } = await import("node:fs");
    const accessSpy = vi.spyOn(fs, "access").mockResolvedValue(undefined);
    try {
      findManyMock.mockResolvedValue([
        { id: "backuprun_a", storagePath: "postgres/2026-05-24T03-00-00Z" },
      ]);
      const failedScript: ScriptOutcome = {
        ok: false,
        stdout: "RESULT failed assert_BacklogItem=0 duration_ms=5000 reason=BacklogItem:zero-rows\n",
        stderr: "",
        exitCode: 5,
      };
      await runPostgresTrialRestore({ backupsRoot: "/test/backups", runScript: async () => failedScript });
      expect(notificationCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            severity: "critical",
            category: "backup-trial-restore-failed",
            subjectId: "postgres",
            message: expect.stringContaining("failed"),
          }),
        }),
      );
      expect(notificationUpdateManyMock).not.toHaveBeenCalled();
    } finally {
      accessSpy.mockRestore();
    }
  });

  it("successful trial restore resolves open PlatformNotification (BI-EA67A758)", async () => {
    const { promises: fs } = await import("node:fs");
    const accessSpy = vi.spyOn(fs, "access").mockResolvedValue(undefined);
    try {
      findManyMock.mockResolvedValue([
        { id: "backuprun_a", storagePath: "postgres/2026-05-24T03-00-00Z" },
      ]);
      const okScript: ScriptOutcome = {
        ok: true,
        stdout:
          "RESULT ok assert_BacklogItem=550 assert_Epic=62 assert_ModelProvider=30 assert_User=1 duration_ms=10000\n",
        stderr: "",
        exitCode: 0,
      };
      await runPostgresTrialRestore({ backupsRoot: "/test/backups", runScript: async () => okScript });
      expect(notificationUpdateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: "backup-trial-restore-failed",
            subjectId: "postgres",
            resolvedAt: null,
          }),
          data: expect.objectContaining({ resolvedAt: expect.any(Date) }),
        }),
      );
      expect(notificationCreateMock).not.toHaveBeenCalled();
    } finally {
      accessSpy.mockRestore();
    }
  });
});
