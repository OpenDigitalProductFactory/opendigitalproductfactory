/**
 * Unit tests for the shared managed-backup engine (EP-8DC217EB BET-11,
 * BI-B72328D5), parametrized across all three engine specs. Mirrors the
 * mocking idiom of postgres-restore-runner.test.ts: mock prisma, the
 * metrics module and the managed-script chokepoint; use the real fs against
 * a temp directory.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@dpf/db", () => ({ prisma: {} }));

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
  isoTsForDirectory,
  nextDailyRunAt,
  runManagedBackup,
} from "./managed-backup";
import {
  NEO4J_BACKUP_SPEC,
  POSTGRES_BACKUP_SPEC,
  QDRANT_BACKUP_SPEC,
  type BackupEngineSpec,
} from "./engine-specs";
import { runManagedScript } from "./managed-script-path";

type Mock = ReturnType<typeof vi.fn>;
const runScriptMock = runManagedScript as unknown as Mock;

const FIXED_NOW = new Date("2026-07-09T05:00:00.000Z");
const EXPECTED_TS_KEY = "2026-07-09T05-00-00Z";
const EXPECTED_NEXT_RUN = new Date("2026-07-10T03:00:00.000Z");

interface EngineCase {
  spec: BackupEngineSpec;
  /** stderr line the shell script emits on failure. */
  failLine: string;
  /** what summarizeScriptFailure should extract from failLine. */
  expectedSummary: string;
}

const ENGINES: EngineCase[] = [
  {
    spec: POSTGRES_BACKUP_SPEC,
    failLine: "[backup-trace] failed: pg_dump exploded",
    expectedSummary: "pg_dump exploded",
  },
  {
    spec: NEO4J_BACKUP_SPEC,
    failLine: "[backup-neo4j-trace] failed: neo4j-admin dump borked",
    expectedSummary: "neo4j-admin dump borked",
  },
  {
    spec: QDRANT_BACKUP_SPEC,
    failLine: "[backup-qdrant-trace] failed: snapshot upload borked",
    expectedSummary: "snapshot upload borked",
  },
];

function makePrisma(opts?: {
  retentionRows?: Array<Record<string, unknown>>;
  retainedRows?: Array<{ sizeBytes: bigint | null }>;
}) {
  return {
    backupRun: {
      create: vi.fn().mockResolvedValue({ id: "run-1" }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockImplementation(async (query: { where?: { status?: string } }) =>
        query?.where?.status === "ok"
          ? opts?.retainedRows ?? []
          : opts?.retentionRows ?? [],
      ),
    },
    scheduledJob: { update: vi.fn().mockResolvedValue({}) },
  };
}

async function makeBackupsRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "managed-backup-test-"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shared helpers", () => {
  it("isoTsForDirectory replaces colons and drops millis", () => {
    expect(isoTsForDirectory(FIXED_NOW)).toBe(EXPECTED_TS_KEY);
  });

  it("nextDailyRunAt returns the next 03:00 UTC strictly after `from`", () => {
    expect(nextDailyRunAt(FIXED_NOW)).toEqual(EXPECTED_NEXT_RUN);
    expect(nextDailyRunAt(new Date("2026-07-09T02:59:00.000Z"))).toEqual(
      new Date("2026-07-09T03:00:00.000Z"),
    );
    // Exactly 03:00 rolls to the next day (strictly-after semantics).
    expect(nextDailyRunAt(new Date("2026-07-09T03:00:00.000Z"))).toEqual(
      new Date("2026-07-10T03:00:00.000Z"),
    );
  });
});

describe.each(ENGINES)("runManagedBackup — $spec.target", ({ spec, failLine, expectedSummary }) => {
  it("success path writes the BackupRun row, both heartbeats, metrics and manifest fields", async () => {
    const backupsRoot = await makeBackupsRoot();
    const targetDir = path.posix.join(backupsRoot, spec.subdir, EXPECTED_TS_KEY);
    const prisma = makePrisma({ retainedRows: [{ sizeBytes: BigInt(2048) }] });

    runScriptMock.mockImplementation(async () => {
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(
        path.posix.join(targetDir, "manifest.json"),
        JSON.stringify({ sizeBytes: 2048, sha256: "deadbeef", pgVersion: "16.3" }),
      );
      return { ok: true, stdout: "", stderr: "", exitCode: 0 };
    });

    const result = await runManagedBackup(spec, {
      trigger: "scheduled",
      backupsRoot,
      composeProject: "dpf",
      prismaClient: prisma as never,
      now: () => FIXED_NOW,
    });

    expect(result).toEqual({ runId: "run-1", status: "ok" });

    // Row created up-front in `running` state with the engine's identity.
    expect(prisma.backupRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        target: spec.target,
        status: "running",
        trigger: "scheduled",
        schedule: spec.schedule,
        storagePath: `${spec.subdir}/${EXPECTED_TS_KEY}`,
      }),
      select: { id: true },
    });

    // Script spawned via the /bin/sh chokepoint with the engine's timeout
    // and TARGET_DIR wired into the env.
    expect(runScriptMock).toHaveBeenCalledWith(
      `/app/scripts/${spec.scriptName}`,
      expect.objectContaining({
        timeoutMs: spec.timeoutMs,
        env: expect.objectContaining({ TARGET_DIR: targetDir }),
      }),
    );

    // Success row update: manifest fields; pgVersion only for postgres.
    const updateData = (prisma.backupRun.update as Mock).mock.calls[0][0].data;
    expect(updateData).toMatchObject({
      status: "ok",
      sizeBytes: BigInt(2048),
      sha256: "deadbeef",
    });
    if (spec.target === "postgres") {
      expect(updateData.pgVersion).toBe("16.3");
    } else {
      expect("pgVersion" in updateData).toBe(false);
    }

    // Two heartbeats: running, then ok with the next 03:00 UTC.
    const heartbeats = (prisma.scheduledJob.update as Mock).mock.calls;
    expect(heartbeats).toHaveLength(2);
    expect(heartbeats[0][0]).toEqual({
      where: { jobId: spec.jobId },
      data: { lastRunAt: FIXED_NOW, lastStatus: "running", lastError: null },
    });
    expect(heartbeats[1][0]).toEqual({
      where: { jobId: spec.jobId },
      data: {
        lastRunAt: FIXED_NOW,
        lastStatus: "ok",
        lastError: null,
        nextRunAt: EXPECTED_NEXT_RUN,
      },
    });

    // Metrics: the engine's own (existing) metric objects.
    expect(spec.metrics.runsTotal.inc).toHaveBeenCalledWith({
      status: "ok",
      trigger: "scheduled",
    });
    expect(spec.metrics.durationSeconds.observe).toHaveBeenCalledWith(
      { trigger: "scheduled" },
      0,
    );
    expect(spec.metrics.lastSuccessSeconds.set).toHaveBeenCalledWith(
      Math.floor(FIXED_NOW.getTime() / 1000),
    );
    expect(spec.metrics.storageBytes.set).toHaveBeenCalledWith(2048);

    // Retention queried for THIS engine's target.
    expect(prisma.backupRun.findMany).toHaveBeenCalledWith({
      where: { target: spec.target },
      orderBy: { startedAt: "desc" },
    });

    await fs.rm(backupsRoot, { recursive: true, force: true });
  });

  it("failure path records the summarized error, failure heartbeat and failure metrics", async () => {
    const backupsRoot = await makeBackupsRoot();
    const prisma = makePrisma();

    runScriptMock.mockResolvedValue({
      ok: false,
      stdout: "",
      stderr: `some noise\n${failLine}\n`,
      exitCode: 2,
    });

    const result = await runManagedBackup(spec, {
      trigger: "manual",
      backupsRoot,
      prismaClient: prisma as never,
      now: () => FIXED_NOW,
    });

    expect(result).toEqual({
      runId: "run-1",
      status: "failed",
      error: expectedSummary,
    });

    expect(prisma.backupRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: expectedSummary,
      }),
    });

    const heartbeats = (prisma.scheduledJob.update as Mock).mock.calls;
    expect(heartbeats[1][0].data).toEqual({
      lastRunAt: FIXED_NOW,
      lastStatus: "failed",
      lastError: expectedSummary,
      nextRunAt: EXPECTED_NEXT_RUN,
    });

    expect(spec.metrics.runsTotal.inc).toHaveBeenCalledWith({
      status: "failed",
      trigger: "manual",
    });
    expect(spec.metrics.lastSuccessSeconds.set).not.toHaveBeenCalled();
    expect(spec.metrics.storageBytes.set).not.toHaveBeenCalled();
    // No retention sweep on failure.
    expect(prisma.backupRun.findMany).not.toHaveBeenCalled();

    await fs.rm(backupsRoot, { recursive: true, force: true });
  });

  it("script ok but missing manifest fails with the engine's no-diagnostic fallback", async () => {
    const backupsRoot = await makeBackupsRoot();
    const prisma = makePrisma();

    // ok:true but the script never wrote manifest.json.
    runScriptMock.mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 });

    const result = await runManagedBackup(spec, {
      trigger: "manual",
      backupsRoot,
      prismaClient: prisma as never,
      now: () => FIXED_NOW,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toBe(spec.failureFallback);

    await fs.rm(backupsRoot, { recursive: true, force: true });
  });
});

describe("runManagedBackup — retention pruning", () => {
  it("deletes only the runs the GFS policy drops and flips their prunedAt", async () => {
    const backupsRoot = await makeBackupsRoot();
    const targetDir = path.posix.join(backupsRoot, "postgres", EXPECTED_TS_KEY);
    const oldDir = path.posix.join(backupsRoot, "postgres", "old-run");
    await fs.mkdir(oldDir, { recursive: true });
    await fs.writeFile(path.posix.join(oldDir, "dpf.dump"), "old-bytes");

    const twoDaysAgo = new Date("2026-07-07T05:00:00.000Z");
    const prisma = makePrisma({
      retentionRows: [
        {
          id: "keep-me",
          status: "ok",
          startedAt: FIXED_NOW,
          finishedAt: FIXED_NOW,
          prunedAt: null,
          storagePath: `postgres/${EXPECTED_TS_KEY}`,
        },
        {
          id: "prune-me",
          status: "ok",
          startedAt: twoDaysAgo,
          finishedAt: twoDaysAgo,
          prunedAt: null,
          storagePath: "postgres/old-run",
        },
      ],
      retainedRows: [{ sizeBytes: BigInt(2048) }],
    });

    runScriptMock.mockImplementation(async () => {
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(
        path.posix.join(targetDir, "manifest.json"),
        JSON.stringify({ sizeBytes: 2048, sha256: "deadbeef", pgVersion: "16.3" }),
      );
      return { ok: true, stdout: "", stderr: "", exitCode: 0 };
    });

    // daily:1/weekly:1/monthly:1 with both runs in the same ISO week + month
    // ⇒ only the newest run is kept; the old one is pruned.
    await runManagedBackup(POSTGRES_BACKUP_SPEC, {
      trigger: "scheduled",
      backupsRoot,
      retention: { daily: 1, weekly: 1, monthly: 1 },
      prismaClient: prisma as never,
      now: () => FIXED_NOW,
    });

    // Old run's directory is gone from disk...
    await expect(fs.access(oldDir)).rejects.toThrow();
    // ...the kept run's directory is not.
    await expect(fs.access(targetDir)).resolves.toBeUndefined();
    // ...and only the pruned run got its prunedAt flipped.
    expect(prisma.backupRun.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.backupRun.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["prune-me"] } },
      data: { prunedAt: expect.any(Date) },
    });

    await fs.rm(backupsRoot, { recursive: true, force: true });
  });
});
