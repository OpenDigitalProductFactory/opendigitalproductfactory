import { beforeEach, describe, expect, it, vi } from "vitest";

import { readCapturedBackupPair } from "./captured-backup-pair";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), readUploadsCustody: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { backupRun: { findMany: mocks.findMany } } }));
vi.mock("./uploads-custody", () => ({ readUploadsCustody: mocks.readUploadsCustody }));

const postgres = { id: "BR-PG", storagePath: "postgres/pg", sha256: "a".repeat(64), status: "ok", target: "postgres", prunedAt: null };
const uploads = { id: "BR-UP", storagePath: "uploads/up", sha256: "b".repeat(64), status: "ok", target: "uploads", prunedAt: null };
const custody = {
  schemaVersion: 1, runId: uploads.id, storagePath: uploads.storagePath, archiveSha256: uploads.sha256,
  manifestSha256: "c".repeat(64), pairedPostgresRunId: postgres.id, pairedPostgresSha256: postgres.sha256,
};
const request = { postgresRunId: postgres.id, uploadsRunId: uploads.id, backupsRoot: "/fixture-backups" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([uploads, postgres]);
  mocks.readUploadsCustody.mockResolvedValue(custody);
});

describe("exact captured pair", () => {
  it("binds the two retained rows to the independent upload custody receipt", async () => {
    await expect(readCapturedBackupPair(request)).resolves.toEqual({
      schemaVersion: 2,
      postgres: { runId: postgres.id, storagePath: postgres.storagePath, sha256: postgres.sha256 },
      uploads: {
        runId: uploads.id, storagePath: uploads.storagePath, sha256: uploads.sha256,
        manifestSha256: custody.manifestSha256, pairedPostgresRunId: postgres.id, pairedPostgresSha256: postgres.sha256,
      },
    });
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ id: { in: [postgres.id, uploads.id] } });
    expect(mocks.readUploadsCustody).toHaveBeenCalledExactlyOnceWith(request.backupsRoot, uploads.id);
  });

  it.each([
    [uploads],
    [{ ...postgres, prunedAt: new Date("2026-06-01T00:00:00Z") }, uploads],
    [postgres, { ...uploads, status: "failed" }],
    [postgres, { ...uploads, target: "postgres" }],
    [postgres, { ...uploads, sha256: null }],
  ])("refuses a missing, failed, pruned or wrong target member %#", async (...rows) => {
    mocks.findMany.mockResolvedValue(rows);
    await expect(readCapturedBackupPair(request)).rejects.toThrow(/retained/i);
    expect(mocks.readUploadsCustody).not.toHaveBeenCalled();
  });

  it.each([
    { runId: "BR-ELSE" },
    { archiveSha256: "d".repeat(64) },
    { storagePath: "uploads/elsewhere" },
    { pairedPostgresRunId: "BR-ELSE" },
    { pairedPostgresSha256: "d".repeat(64) },
  ])("refuses a custody mismatch %#", async (change) => {
    mocks.readUploadsCustody.mockResolvedValue({ ...custody, ...change });
    await expect(readCapturedBackupPair(request)).rejects.toThrow(/custody/i);
  });
});
