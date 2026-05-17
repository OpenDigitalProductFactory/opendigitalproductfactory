import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock prisma + the Slice-1 safety-dump entry point + the metrics module so
// the unit tests run without a live DB or live runner.
vi.mock("@dpf/db", () => ({
  prisma: {
    backupRun: { findUnique: vi.fn() },
    backupRestore: { create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("./postgres-backup-runner", () => ({
  runPostgresBackup: vi.fn(),
}));

vi.mock("@/lib/operate/metrics", () => ({
  postgresRestoreRunsTotal: { inc: vi.fn() },
  postgresRestoreDurationSeconds: { observe: vi.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import {
  RestoreIntegrityError,
  RestoreLockedError,
  __test__,
  isRestoreInFlight,
  runPostgresRestore,
} from "./postgres-restore-runner";
import { prisma } from "@dpf/db";
import { runPostgresBackup } from "./postgres-backup-runner";

const mockPrisma = prisma as unknown as {
  backupRun: { findUnique: ReturnType<typeof vi.fn> };
  backupRestore: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};
const mockedSafety = runPostgresBackup as unknown as ReturnType<typeof vi.fn>;

describe("acquireRestoreLock (unit)", () => {
  beforeEach(() => {
    __test__.resetLockForTest();
  });

  it("acquires a lock when none is held", () => {
    expect(isRestoreInFlight().inFlight).toBe(false);
    const release = __test__.acquireRestoreLock("holder-1");
    expect(isRestoreInFlight().inFlight).toBe(true);
    release();
    expect(isRestoreInFlight().inFlight).toBe(false);
  });

  it("throws RestoreLockedError when a second restore tries to acquire", () => {
    const release = __test__.acquireRestoreLock("holder-a");
    expect(() => __test__.acquireRestoreLock("holder-b")).toThrow(
      RestoreLockedError,
    );
    release();
    // After release, a new caller can acquire.
    const release2 = __test__.acquireRestoreLock("holder-c");
    release2();
  });
});

describe("runPostgresRestore", () => {
  beforeEach(() => {
    __test__.resetLockForTest();
    mockPrisma.backupRun.findUnique.mockReset();
    mockPrisma.backupRestore.create.mockReset();
    mockPrisma.backupRestore.update.mockReset();
    mockedSafety.mockReset();
  });

  it("throws RestoreIntegrityError when the source BackupRun is missing", async () => {
    mockPrisma.backupRun.findUnique.mockResolvedValue(null);
    await expect(
      runPostgresRestore({ sourceBackupRunId: "missing" }),
    ).rejects.toThrow(RestoreIntegrityError);
    // Lock must be released even on failure.
    expect(isRestoreInFlight().inFlight).toBe(false);
  });

  it("throws RestoreIntegrityError when the source has been pruned", async () => {
    mockPrisma.backupRun.findUnique.mockResolvedValue({
      id: "src",
      status: "ok",
      prunedAt: new Date(),
      storagePath: "postgres/foo",
      sha256: null,
    });
    await expect(
      runPostgresRestore({ sourceBackupRunId: "src" }),
    ).rejects.toThrow(/pruned/);
    expect(isRestoreInFlight().inFlight).toBe(false);
  });

  it("throws RestoreIntegrityError when source status is failed", async () => {
    mockPrisma.backupRun.findUnique.mockResolvedValue({
      id: "src",
      status: "failed",
      prunedAt: null,
      storagePath: "postgres/foo",
      sha256: null,
    });
    await expect(
      runPostgresRestore({ sourceBackupRunId: "src" }),
    ).rejects.toThrow(/only successful backups/i);
  });

  it("throws RestoreIntegrityError when the dump file is missing from disk", async () => {
    mockPrisma.backupRun.findUnique.mockResolvedValue({
      id: "src",
      status: "ok",
      prunedAt: null,
      storagePath: "postgres/this-path-does-not-exist-xyz",
      sha256: null,
    });
    await expect(
      runPostgresRestore({
        sourceBackupRunId: "src",
        backupsRoot: "/nonexistent-test-root-9999",
      }),
    ).rejects.toThrow(/missing/i);
    expect(isRestoreInFlight().inFlight).toBe(false);
    // No BackupRestore row should have been inserted because we never got
    // past the integrity check.
    expect(mockPrisma.backupRestore.create).not.toHaveBeenCalled();
  });
});
