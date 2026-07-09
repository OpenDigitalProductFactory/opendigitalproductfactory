/**
 * Unit tests for the shared managed-restore engine (EP-8DC217EB BET-11,
 * BI-B72328D5), parametrized across all three restore specs. Mirrors the
 * mocking idiom of postgres-restore-runner.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@dpf/db", () => ({
  prisma: {
    backupRun: { findUnique: vi.fn(), upsert: vi.fn() },
    backupRestore: { create: vi.fn() },
  },
}));

vi.mock("@/lib/operate/metrics", () => {
  const counter = () => ({ inc: vi.fn() });
  const gauge = () => ({ set: vi.fn() });
  const histogram = () => ({ observe: vi.fn() });
  return {
    postgresBackupRunsTotal: counter(),
    postgresBackupLastSuccessSeconds: gauge(),
    postgresBackupStorageBytes: gauge(),
    postgresBackupDurationSeconds: histogram(),
    neo4jBackupRunsTotal: counter(),
    neo4jBackupLastSuccessSeconds: gauge(),
    neo4jBackupStorageBytes: gauge(),
    neo4jBackupDurationSeconds: histogram(),
    qdrantBackupRunsTotal: counter(),
    qdrantBackupLastSuccessSeconds: gauge(),
    qdrantBackupStorageBytes: gauge(),
    qdrantBackupDurationSeconds: histogram(),
    postgresRestoreRunsTotal: counter(),
    postgresRestoreDurationSeconds: histogram(),
  };
});

vi.mock("./managed-script-path", () => ({
  resolveManagedScriptPath: vi.fn((name: string) => `/app/scripts/${name}`),
  runManagedScript: vi.fn(),
}));

import {
  RestoreIntegrityError,
  RestoreLockedError,
  __test__,
  isRestoreInFlight,
  runManagedRestore,
} from "./managed-restore";
import {
  NEO4J_RESTORE_SPEC,
  POSTGRES_RESTORE_SPEC,
  QDRANT_RESTORE_SPEC,
  type RestoreEngineSpec,
} from "./engine-specs";
import { runManagedScript } from "./managed-script-path";

type Mock = ReturnType<typeof vi.fn>;
const runScriptMock = runManagedScript as unknown as Mock;

interface RestoreCase {
  spec: RestoreEngineSpec;
  subdir: string;
  failLine: string;
  prunedText: RegExp;
  checksumText: RegExp;
}

const ENGINES: RestoreCase[] = [
  {
    spec: POSTGRES_RESTORE_SPEC,
    subdir: "postgres",
    failLine: "[restore-trace] failed: pg_restore boom",
    prunedText: /its file is no longer on disk/,
    checksumText: /checksum does not match what was recorded/,
  },
  {
    spec: NEO4J_RESTORE_SPEC,
    subdir: "neo4j",
    failLine: "[restore-neo4j-trace] failed: pg_restore boom",
    prunedText: /pruned; file is gone/,
    checksumText: /Source dump checksum mismatch/,
  },
  {
    spec: QDRANT_RESTORE_SPEC,
    subdir: "qdrant",
    failLine: "[restore-qdrant-trace] failed: pg_restore boom",
    prunedText: /pruned; file is gone/,
    checksumText: /Source snapshot checksum mismatch/,
  },
];

function makePrisma() {
  return {
    backupRun: { findUnique: vi.fn(), upsert: vi.fn().mockResolvedValue({}) },
    backupRestore: { create: vi.fn().mockResolvedValue({ id: "restore-1" }) },
  };
}

function makeSource(spec: RestoreEngineSpec, storagePath: string) {
  return {
    id: "src",
    target: spec.target,
    startedAt: new Date("2026-07-08T03:00:00.000Z"),
    finishedAt: new Date("2026-07-08T03:01:00.000Z"),
    status: "ok",
    trigger: "scheduled",
    schedule: "daily",
    sizeBytes: BigInt(2048),
    durationMs: 60_000,
    sha256: null as string | null,
    pgVersion: null,
    dpfVersion: null,
    storagePath,
    errorMessage: null,
    prunedAt: null as Date | null,
    createdAt: new Date("2026-07-08T03:00:00.000Z"),
  };
}

async function makeArtifact(spec: RestoreEngineSpec, subdir: string) {
  const backupsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "managed-restore-test-"));
  const storagePath = `${subdir}/2026-07-08T03-00-00Z`;
  const runDir = path.posix.join(backupsRoot, storagePath);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.posix.join(runDir, spec.artifactFileName), "dump-bytes");
  return { backupsRoot, storagePath };
}

const okSafety = async () => ({ runId: "safety-1", status: "ok" as const });

beforeEach(() => {
  vi.clearAllMocks();
  __test__.resetLockForTest();
});

describe("restore lock", () => {
  it("acquire/release round-trips and surfaces via isRestoreInFlight", () => {
    expect(isRestoreInFlight().inFlight).toBe(false);
    const release = __test__.acquireRestoreLock("holder-1");
    expect(isRestoreInFlight()).toMatchObject({ inFlight: true, holder: "holder-1" });
    release();
    expect(isRestoreInFlight().inFlight).toBe(false);
  });

  it.each(ENGINES)(
    "$spec.target: rejects with RestoreLockedError while another restore holds the lock",
    async ({ spec }) => {
      const release = __test__.acquireRestoreLock("other-restore");
      const prisma = makePrisma();
      await expect(
        runManagedRestore(spec, { sourceBackupRunId: "src", prismaClient: prisma as never }),
      ).rejects.toThrow(RestoreLockedError);
      // The original holder still owns the lock.
      expect(isRestoreInFlight()).toMatchObject({ inFlight: true, holder: "other-restore" });
      release();
    },
  );
});

describe.each(ENGINES)(
  "runManagedRestore — $spec.target integrity checks",
  ({ spec, subdir, prunedText, checksumText }) => {
    it("throws when the source BackupRun is missing and releases the lock", async () => {
      const prisma = makePrisma();
      prisma.backupRun.findUnique.mockResolvedValue(null);
      await expect(
        runManagedRestore(spec, { sourceBackupRunId: "missing", prismaClient: prisma as never }),
      ).rejects.toThrow(/not found/);
      expect(isRestoreInFlight().inFlight).toBe(false);
      expect(prisma.backupRestore.create).not.toHaveBeenCalled();
    });

    it("throws when the source status is not ok", async () => {
      const prisma = makePrisma();
      prisma.backupRun.findUnique.mockResolvedValue({
        ...makeSource(spec, `${subdir}/x`),
        status: "failed",
      });
      await expect(
        runManagedRestore(spec, { sourceBackupRunId: "src", prismaClient: prisma as never }),
      ).rejects.toThrow(/only successful backups can be restored/);
    });

    it("throws the engine's pruned wording when the source was pruned", async () => {
      const prisma = makePrisma();
      prisma.backupRun.findUnique.mockResolvedValue({
        ...makeSource(spec, `${subdir}/x`),
        prunedAt: new Date(),
      });
      await expect(
        runManagedRestore(spec, { sourceBackupRunId: "src", prismaClient: prisma as never }),
      ).rejects.toThrow(prunedText);
    });

    it("throws when the artifact file is missing from disk", async () => {
      const prisma = makePrisma();
      prisma.backupRun.findUnique.mockResolvedValue(
        makeSource(spec, `${subdir}/this-path-does-not-exist-xyz`),
      );
      await expect(
        runManagedRestore(spec, {
          sourceBackupRunId: "src",
          backupsRoot: "/nonexistent-test-root-9999",
          prismaClient: prisma as never,
        }),
      ).rejects.toThrow(/missing/i);
      expect(isRestoreInFlight().inFlight).toBe(false);
    });

    it("throws the engine's checksum wording on a sha256 mismatch", async () => {
      const { backupsRoot, storagePath } = await makeArtifact(spec, subdir);
      const prisma = makePrisma();
      prisma.backupRun.findUnique.mockResolvedValue({
        ...makeSource(spec, storagePath),
        sha256: "bogus-recorded-sha",
      });
      await expect(
        runManagedRestore(spec, {
          sourceBackupRunId: "src",
          backupsRoot,
          prismaClient: prisma as never,
        }),
      ).rejects.toThrow(checksumText);
      await fs.rm(backupsRoot, { recursive: true, force: true });
    });

    it("aborts with the engine's wording when the safety backup fails", async () => {
      const { backupsRoot, storagePath } = await makeArtifact(spec, subdir);
      const prisma = makePrisma();
      prisma.backupRun.findUnique.mockResolvedValue(makeSource(spec, storagePath));
      await expect(
        runManagedRestore(spec, {
          sourceBackupRunId: "src",
          backupsRoot,
          prismaClient: prisma as never,
          takeSafetyBackup: async () => ({ runId: "safety-1", status: "failed" }),
        }),
      ).rejects.toThrow(RestoreIntegrityError);
      expect(prisma.backupRestore.create).not.toHaveBeenCalled();
      expect(runScriptMock).not.toHaveBeenCalled();
      await fs.rm(backupsRoot, { recursive: true, force: true });
    });
  },
);

describe("target check", () => {
  it("neo4j/qdrant reject a source whose target does not match", async () => {
    for (const { spec, subdir } of ENGINES.slice(1)) {
      const prisma = makePrisma();
      prisma.backupRun.findUnique.mockResolvedValue({
        ...makeSource(spec, `${subdir}/x`),
        target: "postgres",
      });
      await expect(
        runManagedRestore(spec, { sourceBackupRunId: "src", prismaClient: prisma as never }),
      ).rejects.toThrow(new RegExp(`expected ${spec.target}`));
    }
  });

  it("postgres has no target check (fails later on the missing artifact instead)", async () => {
    const prisma = makePrisma();
    prisma.backupRun.findUnique.mockResolvedValue({
      ...makeSource(POSTGRES_RESTORE_SPEC, "postgres/nope"),
      target: "neo4j",
    });
    await expect(
      runManagedRestore(POSTGRES_RESTORE_SPEC, {
        sourceBackupRunId: "src",
        backupsRoot: "/nonexistent-test-root-9999",
        prismaClient: prisma as never,
      }),
    ).rejects.toThrow(/dump file is missing/);
  });
});

describe.each(ENGINES)(
  "runManagedRestore — $spec.target script execution",
  ({ spec, subdir, failLine }) => {
    async function arrange() {
      const { backupsRoot, storagePath } = await makeArtifact(spec, subdir);
      const prisma = makePrisma();
      const source = makeSource(spec, storagePath);
      const safetyRow = { ...makeSource(spec, `${subdir}/safety`), id: "safety-1" };
      prisma.backupRun.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
        where.id === "src" ? source : where.id === "safety-1" ? safetyRow : null,
      );
      const artifactPath = path.posix.join(backupsRoot, storagePath, spec.artifactFileName);
      return { backupsRoot, prisma, artifactPath };
    }

    it("success path records the audit row and releases the lock", async () => {
      const { backupsRoot, prisma, artifactPath } = await arrange();
      runScriptMock.mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 });

      const result = await runManagedRestore(spec, {
        sourceBackupRunId: "src",
        initiatedByUserId: "user-1",
        trigger: "wizard",
        backupsRoot,
        prismaClient: prisma as never,
        takeSafetyBackup: okSafety,
      });

      expect(result).toEqual({ restoreId: "restore-1", status: "ok" });
      expect(isRestoreInFlight().inFlight).toBe(false);

      // Script spawned with the engine's timeout and DUMP_PATH.
      expect(runScriptMock).toHaveBeenCalledWith(
        `/app/scripts/${spec.scriptName}`,
        expect.objectContaining({
          timeoutMs: spec.timeoutMs,
          env: expect.objectContaining({ DUMP_PATH: artifactPath }),
        }),
      );

      expect(prisma.backupRestore.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: "ok",
          trigger: "wizard",
          sourceBackupRunId: "src",
          preRestoreBackupRunId: "safety-1",
          initiatedByUserId: "user-1",
          errorMessage: null,
        }),
        select: { id: true },
      });

      if (spec === POSTGRES_RESTORE_SPEC) {
        // Postgres re-inserts BOTH audit rows the restore wiped.
        expect(prisma.backupRun.upsert).toHaveBeenCalledTimes(2);
        expect(prisma.backupRun.upsert).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ where: { id: "src" } }),
        );
        expect(prisma.backupRun.upsert).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ where: { id: "safety-1" } }),
        );
        expect(spec.metrics?.runsTotal.inc).toHaveBeenCalledWith({ status: "ok" });
        expect(spec.metrics?.durationSeconds.observe).toHaveBeenCalledWith(0);
      } else {
        // Neo4j/Qdrant never touch Postgres audit rows nor restore metrics.
        expect(prisma.backupRun.upsert).not.toHaveBeenCalled();
        expect(POSTGRES_RESTORE_SPEC.metrics?.runsTotal.inc).not.toHaveBeenCalled();
      }

      await fs.rm(backupsRoot, { recursive: true, force: true });
    });

    it("failure path records the engine-summarized error and still releases the lock", async () => {
      const { backupsRoot, prisma } = await arrange();
      runScriptMock.mockResolvedValue({
        ok: false,
        stdout: "",
        stderr: `noise\n${failLine}\n`,
        exitCode: 1,
      });

      const result = await runManagedRestore(spec, {
        sourceBackupRunId: "src",
        backupsRoot,
        prismaClient: prisma as never,
        takeSafetyBackup: okSafety,
      });

      expect(result).toEqual({ restoreId: "restore-1", status: "failed" });
      expect(isRestoreInFlight().inFlight).toBe(false);
      expect(prisma.backupRestore.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: "failed",
          errorMessage: "pg_restore boom",
        }),
        select: { id: true },
      });
      if (spec === POSTGRES_RESTORE_SPEC) {
        expect(spec.metrics?.runsTotal.inc).toHaveBeenCalledWith({ status: "failed" });
      }

      await fs.rm(backupsRoot, { recursive: true, force: true });
    });
  },
);
