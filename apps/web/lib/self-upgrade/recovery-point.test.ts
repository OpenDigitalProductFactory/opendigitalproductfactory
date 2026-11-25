import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSelfUpgradeRecoveryPoint, summarizeRecoveryPointFailure } from "./recovery-point";

const mocks = vi.hoisted(() => ({
  postgres: vi.fn(),
  uploads: vi.fn(),
  readCapturedBackupPair: vi.fn(),
  readSelfUpgradeRecoveryPoint: vi.fn(),
  persistSelfUpgradeRecoveryPoint: vi.fn(),
}));

vi.mock("@/lib/operate/backups/postgres-backup-runner", () => ({ runPostgresBackup: mocks.postgres }));
vi.mock("@/lib/operate/backups/uploads-backup-runner", () => ({ runUploadsBackup: mocks.uploads }));
vi.mock("@/lib/operate/backups/captured-backup-pair", () => ({
  readCapturedBackupPair: mocks.readCapturedBackupPair,
}));
vi.mock("./recovery-point-store", () => ({
  readSelfUpgradeRecoveryPoint: mocks.readSelfUpgradeRecoveryPoint,
  persistSelfUpgradeRecoveryPoint: mocks.persistSelfUpgradeRecoveryPoint,
}));

const pgSha = "a".repeat(64);
const pair = {
  schemaVersion: 2,
  postgres: { runId: "BR-PG", storagePath: "postgres/point-pg", sha256: pgSha },
  uploads: {
    runId: "BR-UP", storagePath: "uploads/point-up", sha256: "b".repeat(64),
    manifestSha256: "c".repeat(64), pairedPostgresRunId: "BR-PG", pairedPostgresSha256: pgSha,
  },
};
const args = {
  runId: "SUR-TEST",
  composeProject: "dpf-test",
  backupsRoot: "/tmp/paired-recovery-fixture",
  now: () => new Date("2026-06-01T00:00:00.000Z"),
};
const backupArgs = {
  trigger: "pre-upgrade-recovery",
  composeProject: args.composeProject,
  backupsRoot: args.backupsRoot,
};
const point = {
  schemaVersion: 2, status: "ok", trigger: "pre-upgrade-recovery", selfUpgradeRunId: args.runId,
  createdAt: args.now().toISOString(), pairedReceipt: pair, members: [
    { target: "postgres", runId: "BR-PG", status: "ok" },
    { target: "uploads", runId: "BR-UP", status: "ok" },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.postgres.mockResolvedValue({ runId: "BR-PG", status: "ok" });
  mocks.uploads.mockResolvedValue({ runId: "BR-UP", status: "ok" });
  mocks.readCapturedBackupPair.mockResolvedValue(pair);
  mocks.readSelfUpgradeRecoveryPoint.mockResolvedValue(null);
  mocks.persistSelfUpgradeRecoveryPoint.mockResolvedValue(point);
});

describe("self-upgrade recovery point", () => {
  it("captures the exact Postgres/uploads pair, then persists host evidence before reporting success", async () => {
    await expect(createSelfUpgradeRecoveryPoint(args)).resolves.toEqual(point);
    expect(mocks.postgres).toHaveBeenCalledExactlyOnceWith(backupArgs);
    expect(mocks.uploads).toHaveBeenCalledExactlyOnceWith({ ...backupArgs, pairedPostgresRunId: "BR-PG" });
    expect(mocks.readCapturedBackupPair).toHaveBeenCalledExactlyOnceWith({
      backupsRoot: args.backupsRoot, postgresRunId: "BR-PG", uploadsRunId: "BR-UP",
    });
    expect(mocks.persistSelfUpgradeRecoveryPoint).toHaveBeenCalledExactlyOnceWith(args.backupsRoot, point);
    const effects = [mocks.postgres, mocks.uploads, mocks.readCapturedBackupPair, mocks.persistSelfUpgradeRecoveryPoint];
    const calls = effects.map(fn => fn.mock.invocationCallOrder[0]);
    expect(calls).toEqual([...calls].sort((a, b) => a - b));
  });

  it("does not start uploads when the exact Postgres backup fails", async () => {
    mocks.postgres.mockResolvedValue({ runId: "BR-PG", status: "failed" });
    const result = await createSelfUpgradeRecoveryPoint(args);
    expect(result).toMatchObject({ schemaVersion: 2, pairedReceipt: null, status: "failed" });
    expect(mocks.uploads).not.toHaveBeenCalled();
    expect(mocks.persistSelfUpgradeRecoveryPoint).not.toHaveBeenCalled();
    expect(summarizeRecoveryPointFailure(result)).toBe("recovery-point-failed: postgres BR-PG");
  });

  it("captures a thrown runner error as a failed member", async () => {
    mocks.postgres.mockRejectedValue(new Error("pg_dump unavailable"));
    const result = await createSelfUpgradeRecoveryPoint(args);
    expect(result.members[0]).toEqual({ target: "postgres", runId: null, status: "failed", error: "pg_dump unavailable" });
    expect(summarizeRecoveryPointFailure(result)).toBe("recovery-point-failed: postgres: pg_dump unavailable");
  });

  it.each([
    { runId: "BR-UP", status: "failed", error: "archive unavailable" },
    { runId: null, status: "ok" },
  ])("does not downgrade a missing or failed uploads capture %#", async (result) => {
    mocks.uploads.mockResolvedValue(result);
    await expect(createSelfUpgradeRecoveryPoint(args)).resolves.toMatchObject({
      schemaVersion: 2, status: "failed", pairedReceipt: null,
      members: [{ target: "postgres", status: "ok" }, { target: "uploads", status: "failed" }],
    });
    expect(mocks.readCapturedBackupPair).not.toHaveBeenCalled();
    expect(mocks.persistSelfUpgradeRecoveryPoint).not.toHaveBeenCalled();
  });

  it("fails closed on missing host custody", async () => {
    mocks.readCapturedBackupPair.mockRejectedValue(new Error("upload custody not found"));
    const result = await createSelfUpgradeRecoveryPoint(args);
    expect(result).toMatchObject({ schemaVersion: 2, status: "failed", pairedReceipt: null });
    expect(summarizeRecoveryPointFailure(result)).toContain("upload custody not found");
    expect(mocks.persistSelfUpgradeRecoveryPoint).not.toHaveBeenCalled();
  });

  it("blocks a swap when durable evidence cannot be persisted", async () => {
    mocks.persistSelfUpgradeRecoveryPoint.mockRejectedValue(new Error("host backup disk not writable"));
    const result = await createSelfUpgradeRecoveryPoint(args);
    expect(result).toMatchObject({ schemaVersion: 2, status: "failed", pairedReceipt: null });
    expect(summarizeRecoveryPointFailure(result)).toContain("host backup disk not writable");
  });

  it("keeps an earlier host receipt but never reuses it to authorize a restarted swap", async () => {
    mocks.readSelfUpgradeRecoveryPoint.mockResolvedValue(point);
    const result = await createSelfUpgradeRecoveryPoint(args);
    expect(result).toMatchObject({ schemaVersion: 2, status: "failed", pairedReceipt: null });
    expect(summarizeRecoveryPointFailure(result)).toContain("Start a fresh upgrade");
    expect(mocks.readCapturedBackupPair).not.toHaveBeenCalled();
    expect(mocks.postgres).not.toHaveBeenCalled();
    expect(mocks.uploads).not.toHaveBeenCalled();
    expect(mocks.persistSelfUpgradeRecoveryPoint).not.toHaveBeenCalled();
  });

  it("refuses an invalid existing receipt without producing a replacement", async () => {
    mocks.readSelfUpgradeRecoveryPoint.mockRejectedValue(new Error("invalid paired recovery point"));
    await expect(createSelfUpgradeRecoveryPoint(args)).resolves.toMatchObject({
      schemaVersion: 2, status: "failed", pairedReceipt: null,
    });
    expect(mocks.postgres).not.toHaveBeenCalled();
    expect(mocks.persistSelfUpgradeRecoveryPoint).not.toHaveBeenCalled();
  });

  it("skips all backup, custody and host work for a dry run", async () => {
    await expect(createSelfUpgradeRecoveryPoint({ ...args, dryRun: true })).resolves.toMatchObject({
      schemaVersion: 2, status: "skipped", pairedReceipt: null, reason: "dry-run", members: [],
    });
    for (const effect of Object.values(mocks)) expect(effect).not.toHaveBeenCalled();
  });
});
