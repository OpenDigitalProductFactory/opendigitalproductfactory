import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAllBackupReadiness, projectCapabilityBackupReadiness } from "./readiness";

const { prisma, readCustody, listUnfinished } = vi.hoisted(() => ({
  prisma: {
    scheduledJob: { findUnique: vi.fn() },
    backupRun: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    backupRestore: { findFirst: vi.fn() },
    platformNotification: { findFirst: vi.fn() },
  },
  readCustody: vi.fn(),
  listUnfinished: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma }));
vi.mock("@/lib/platform-runtime/operational-state", () => ({
  loadOperationalCapabilityState: async () => ({ capabilityBackupCandidates: [] }),
}));
vi.mock("./uploads-custody", () => ({ readUploadsCustody: readCustody }));
vi.mock("./paired-restore-journal", () => ({ listUnfinishedRestoreJournals: listUnfinished }));

const upload = {
  id: "upload-1", target: "uploads", status: "ok", prunedAt: null,
  startedAt: new Date("2026-11-24T03:00:00Z"), finishedAt: new Date("2026-11-24T03:01:00Z"),
  trigger: "scheduled", sizeBytes: 200n, durationMs: 60_000,
  storagePath: "uploads/2026-11-24", sha256: "a".repeat(64),
};
const postgres = {
  id: "pg-1", target: "postgres", status: "ok", prunedAt: null,
  storagePath: "postgres/2026-11-24", sha256: "b".repeat(64),
};
const custody = {
  schemaVersion: 1, runId: upload.id, storagePath: upload.storagePath, archiveSha256: upload.sha256,
  manifestSha256: "c".repeat(64), pairedPostgresRunId: postgres.id, pairedPostgresSha256: postgres.sha256,
};

describe("upload backup readiness", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.scheduledJob.findUnique.mockImplementation(async ({ where }) => where.jobId === "uploads-daily-backup"
      ? { jobId: where.jobId, schedule: "daily", lastRunAt: upload.startedAt, lastStatus: "ok", lastError: null }
      : null);
    prisma.backupRun.findFirst.mockImplementation(async ({ where }) => where.target === "uploads" ? upload : null);
    prisma.backupRun.findMany.mockResolvedValue([]);
    prisma.backupRun.findUnique.mockResolvedValue(postgres);
    readCustody.mockResolvedValue(custody);
    listUnfinished.mockResolvedValue([]);
  });

  it("reports the uploads heartbeat, latest run, and exact captured pair without claiming a trial passed", async () => {
    expect((await getAllBackupReadiness()).uploads).toMatchObject({
      target: "uploads",
      scheduledJob: { jobId: "uploads-daily-backup", lastRunAt: upload.startedAt.toISOString() },
      lastRun: { id: upload.id, status: "ok" },
      capturePair: { status: "paired", uploadsRunId: upload.id, postgresRunId: postgres.id },
      pairedRestore: { status: "no-unfinished" },
    });
    expect(readCustody).toHaveBeenCalledWith("/backups", upload.id);
  });

  it.each([
    { ...custody, runId: "wrong-upload" },
    { ...custody, storagePath: "uploads/other" },
    { ...custody, archiveSha256: "d".repeat(64) },
    { ...custody, pairedPostgresRunId: "pg-other" },
    { ...custody, pairedPostgresSha256: "d".repeat(64) },
  ])("does not present a pair if custody disagrees with either run", async (changedCustody) => {
    readCustody.mockResolvedValue(changedCustody);
    expect((await getAllBackupReadiness()).uploads.capturePair).toEqual({ status: "unverified" });
  });

  it("keeps a latest failed run visible without borrowing a previous pair for it", async () => {
    prisma.backupRun.findFirst.mockImplementation(async ({ where }) => where.target === "uploads"
      ? where.status ? upload : { ...upload, id: "upload-2", status: "failed" }
      : null);
    expect((await getAllBackupReadiness()).uploads).toMatchObject({
      lastRun: { id: "upload-2", status: "failed" },
      capturePair: { status: "paired", uploadsRunId: "upload-1", postgresRunId: postgres.id },
    });
  });

  it.each([
    null,
    { ...postgres, target: "uploads" },
    { ...postgres, status: "failed" },
    { ...postgres, prunedAt: new Date("2026-11-25T03:00:00Z") },
  ])("requires the exact Postgres member to be successful and retained", async (storedPostgres) => {
    prisma.backupRun.findUnique.mockResolvedValue(storedPostgres);
    expect((await getAllBackupReadiness()).uploads.capturePair).toEqual({ status: "unverified" });
  });

  it("does not turn missing evidence into a successful capture or a clear journal", async () => {
    readCustody.mockRejectedValue(new Error("unavailable"));
    listUnfinished.mockRejectedValue(new Error("unavailable"));
    expect((await getAllBackupReadiness()).uploads).toMatchObject({
      capturePair: { status: "unverified" },
      pairedRestore: { status: "unreadable" },
    });
  });

  it("identifies an unfinished paired restore even with no successful uploads capture", async () => {
    prisma.backupRun.findFirst.mockResolvedValue(null);
    listUnfinished.mockResolvedValue([{ operationId: "restore-1", stage: "uploads-started" }]);
    expect((await getAllBackupReadiness()).uploads).toMatchObject({
      lastRun: null,
      capturePair: { status: "not-captured" },
      pairedRestore: { status: "unfinished", operations: [{ operationId: "restore-1", stage: "uploads-started" }] },
    });
    expect(readCustody).not.toHaveBeenCalled();
  });
});

describe("projectCapabilityBackupReadiness", () => {
  it("uses operational state instead of a consumer-owned service list", () => {
    expect(projectCapabilityBackupReadiness("browser-use", {
      backupServices: ["postgres"],
      serviceStates: { "browser-use": "optional_inactive" },
    })).toEqual({ target: "browser-use", status: "optional_inactive" });

    expect(projectCapabilityBackupReadiness("browser-use", {
      backupServices: ["postgres", "browser-use"],
      serviceStates: { "browser-use": "optional_degraded" },
    })).toEqual({ target: "browser-use", status: "optional_degraded" });
  });
});
