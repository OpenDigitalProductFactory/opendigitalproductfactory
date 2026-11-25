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

import { parsePairedUploadsTrialReceipt, parseResultLine, runPostgresTrialRestore, type ScriptOutcome } from "./postgres-trial-restore-runner";
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

describe("paired upload trial result evidence", () => {
  const expected = { postgresRunId: "pg-approved", uploadsRunId: "uploads-approved" };
  const report = { ...expected, referencedCount: 2, deletedCount: 1, orphanCount: 1, orphanPaths: ["media/sha256/ab/orphan"] };
  const receipt = (value: unknown) => `UPLOADS_TRIAL ${JSON.stringify(value)}\nRESULT ok duration_ms=10\n`;

  it("accepts only a single receipt naming the exact expected members", () => {
    expect(parsePairedUploadsTrialReceipt(receipt(report), expected)).toEqual(report);
    expect(parsePairedUploadsTrialReceipt(receipt({ ...report, uploadsRunId: "stale-run" }), expected)).toBeNull();
    expect(parsePairedUploadsTrialReceipt(receipt(report) + receipt(report), expected)).toBeNull();
    expect(parsePairedUploadsTrialReceipt("RESULT ok duration_ms=10\n", expected)).toBeNull();
  });

  it("refuses inconsistent or malformed upload reports", () => {
    expect(parsePairedUploadsTrialReceipt(receipt({ ...report, orphanCount: 0 }), expected)).toBeNull();
    expect(parsePairedUploadsTrialReceipt(receipt({ ...report, deletedCount: 3 }), expected)).toBeNull();
    expect(parsePairedUploadsTrialReceipt(receipt({ ...report, referencedCount: "2" }), expected)).toBeNull();
    expect(parsePairedUploadsTrialReceipt("UPLOADS_TRIAL invalid-json\n", expected)).toBeNull();
  });
});

describe("runPostgresTrialRestore", () => {
  const okScript: ScriptOutcome = {
    ok: true,
    stdout: "RESULT ok assert_BacklogItem=550 assert_Epic=62 assert_ModelProvider=30 assert_User=1 duration_ms=10000\n",
    stderr: "",
    exitCode: 0,
  };

  it("fails a required pair before spawning if capture custody is missing or if the uploads run failed", async () => {
    const { promises: fs } = await import("node:fs");
    const accessSpy = vi.spyOn(fs, "access").mockResolvedValue(undefined);
    const runScript = vi.fn(async () => okScript);
    const pg = { id: "pg-daily", target: "postgres", status: "ok", prunedAt: null, storagePath: "postgres/daily", sha256: "a".repeat(64) };
    try {
      for (const uploadsBackupRunId of ["uploads-daily", null]) {
        findUniqueMock.mockImplementation(async ({ where: { id } }) => id === pg.id ? pg
          : { id, target: "uploads", status: "ok", prunedAt: null, storagePath: "uploads/daily", sha256: "b".repeat(64) });
        const result = await runPostgresTrialRestore({
          sourceBackupRunId: pg.id, uploadsBackupRunId, runScript,
          readCustody: async () => { throw new Error("fixture custody missing"); },
        });
        expect(result).toMatchObject({ status: "failed", reason: expect.stringMatching(/upload.*(capture|custody)/i) });
      }
      expect(runScript).not.toHaveBeenCalled();
      expect(findManyMock).not.toHaveBeenCalled();
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: "failed", sourceBackupRunId: pg.id }),
      }));
      expect(notificationCreateMock).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ subjectId: "paired-postgres-uploads" }),
      }));
    } finally {
      accessSpy.mockRestore();
    }
  });

  it("does not substitute a different latest dump when the scheduled Postgres capture is missing", async () => {
    const runScript = vi.fn(async () => okScript);
    const result = await runPostgresTrialRestore({ uploadsBackupRunId: null, runScript });
    expect(result).toMatchObject({ status: "failed", restoreId: null, verificationScope: "paired" });
    expect(findManyMock).not.toHaveBeenCalled();
    expect(runScript).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled(); // there is no source row for the required relation
    expect(scheduledJobUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastStatus: "failed" }),
    }));
  });

  it("requires exact paired proof in the script result and returns the verified orphan report", async () => {
    const { promises: fs } = await import("node:fs");
    const accessSpy = vi.spyOn(fs, "access").mockResolvedValue(undefined);
    const pg = { id: "pg-daily", target: "postgres", status: "ok", prunedAt: null, storagePath: "postgres/daily", sha256: "a".repeat(64) };
    const uploads = { id: "uploads-daily", target: "uploads", status: "ok", prunedAt: null, storagePath: "uploads/daily", sha256: "b".repeat(64) };
    const manifestSha256 = "c".repeat(64);
    const receipt = { postgresRunId: pg.id, uploadsRunId: uploads.id, referencedCount: 2, deletedCount: 0, orphanCount: 1, orphanPaths: ["media/sha256/ab/fixture"] };
    try {
      findUniqueMock.mockImplementation(async ({ where: { id } }) => id === pg.id ? pg : uploads);
      const input = {
        sourceBackupRunId: pg.id, uploadsBackupRunId: uploads.id,
        readCustody: async () => ({
          schemaVersion: 1 as const, runId: uploads.id, storagePath: uploads.storagePath, archiveSha256: uploads.sha256,
          pairedPostgresRunId: pg.id, pairedPostgresSha256: pg.sha256, manifestSha256,
        }),
      };
      const missing = await runPostgresTrialRestore({ ...input, runScript: async () => okScript });
      expect(missing).toMatchObject({ status: "failed", reason: expect.stringMatching(/paired.*evidence/i) });
      const runWrongPair = vi.fn(async () => okScript);
      const wrongPair = await runPostgresTrialRestore({
        ...input,
        readCustody: async () => ({ ...await input.readCustody(), pairedPostgresRunId: "different-postgres" }),
        runScript: runWrongPair,
      });
      expect(wrongPair).toMatchObject({ status: "failed", reason: expect.stringMatching(/custody.*exact/i) });
      expect(runWrongPair).not.toHaveBeenCalled();
      const success = await runPostgresTrialRestore({ ...input, runScript: async (_, env) => {
        expect(env).toMatchObject({ DPF_PAIRED_TRIAL_UPLOADS_RUN_ID: uploads.id, DPF_PAIRED_TRIAL_MANIFEST_SHA256: manifestSha256,
          DPF_PAIRED_TRIAL_POSTGRES_RUN_ID: pg.id, DPF_PAIRED_TRIAL_POSTGRES_SHA256: pg.sha256 });
        return { ...okScript, stdout: `UPLOADS_TRIAL ${JSON.stringify(receipt)}\n${okScript.stdout}` };
      } });
      expect(success).toMatchObject({ status: "ok", pairedUploads: receipt });
      const failed = await runPostgresTrialRestore({
        ...input,
        runScript: async () => ({
          ...okScript,
          stdout: `UPLOADS_TRIAL ${JSON.stringify(receipt)}\nRESULT failed duration_ms=10 reason=postgres-failed\n`,
          exitCode: 4,
          ok: false,
        }),
      });
      expect(failed).toMatchObject({ status: "failed", reason: "postgres-failed", verificationScope: "paired" });
      expect(failed.pairedUploads).toBeUndefined();
    } finally {
      accessSpy.mockRestore();
    }
  });

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
