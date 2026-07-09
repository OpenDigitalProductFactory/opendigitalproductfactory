/**
 * Shared managed-backup engine (EP-8DC217EB BET-11, BI-B72328D5).
 *
 * `runManagedBackup(spec, args)` is the single implementation of the backup
 * lifecycle that postgres-backup-runner.ts, neo4j-backup-runner.ts and
 * qdrant-backup-runner.ts previously each carried as a near-verbatim copy:
 *
 *   1. Allocate a per-run target directory under /backups/<subdir>/<ISO-ts>.
 *   2. Spawn the engine's managed shell script via the /bin/sh chokepoint.
 *   3. Read back the manifest, insert a BackupRun row (status ok/failed).
 *   4. Update the ScheduledJob heartbeat (one `recordJobHeartbeat` helper —
 *      the runners used to inline three copy-pasted scheduledJob.update
 *      blocks each).
 *   5. Apply GFS retention — delete file directories for runs the policy no
 *      longer keeps and mark them prunedAt.
 *   6. Emit engine trace logs and the engine's Prometheus metrics (the metric
 *      OBJECTS still live in @/lib/operate/metrics under their original
 *      names — dashboards depend on them; the spec only carries references).
 *
 * Every per-engine difference (job id, script name, timeout, trace tag,
 * failure-marker grammar, script env, extra success-row fields) lives in the
 * BackupEngineSpec (see engine-specs.ts). This file is one of the two
 * canonical homes enforced by scripts/check-no-local-backup-helper.mjs —
 * do not re-inline these helpers in a runner.
 *
 * Per the never-ask-user-to-run-commands kernel principle, the operator
 * never sees any of the shell commands here. Failure is reported through
 * BackupRun.errorMessage and rendered as a human-readable readiness banner.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { partitionForRetention } from "./retention";
import {
  DEFAULT_BACKUP_RETENTION,
  type BackupRetentionPolicy,
  type BackupTarget,
  type BackupTrigger,
} from "./types";
import { resolveManagedScriptPath, runManagedScript } from "./managed-script-path";
import type { AnyBackupManifest, BackupEngineSpec } from "./engine-specs";

const BACKUPS_ROOT = "/backups";

export type PrismaLike = typeof import("@dpf/db").prisma;

export interface ScriptOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Args shared by all three engine entry points (runPostgresBackup etc.). */
export interface ManagedBackupArgs {
  trigger: BackupTrigger;
  /**
   * Compose project name. Used by engines whose script env derives container
   * names (`<project>-postgres-1`, `<project>-neo4j-1`) so worktree-isolated
   * stacks back themselves up independently. Defaults to "dpf".
   */
  composeProject?: string;
  /** Override the GFS retention policy for tests / future config slider. */
  retention?: BackupRetentionPolicy;
  /** Override the backup root for tests. */
  backupsRoot?: string;
  /** Override script path for tests. */
  scriptPath?: string;
  /** Inject the prisma client (for testing without a live DB). */
  prismaClient?: PrismaLike;
  /** Inject a clock for deterministic testing. */
  now?: () => Date;
}

/**
 * 2026-05-17T03-00-00Z — colons replaced with hyphens for cross-fs safety.
 * Canonical home (was copy-pasted into all three backup runners).
 */
export function isoTsForDirectory(d: Date): string {
  return d.toISOString().replace(/:/g, "-").replace(/\.\d+/, "");
}

/**
 * Compute the next 03:00 UTC strictly after `from`. Mirrors the seed helper
 * so heartbeat math is consistent at every layer. Canonical home.
 */
export function nextDailyRunAt(from: Date): Date {
  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(0);
  next.setUTCHours(3);
  if (next <= from) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/**
 * The ONE ScheduledJob heartbeat write. Replaces the three inline
 * `prisma.scheduledJob.update(...).catch(() => {})` blocks each runner
 * carried (start / success / failure). Optional fields are omitted from the
 * update payload entirely so the write shape matches the originals exactly.
 *
 * Swallows the update error by design: the heartbeat row may not exist yet
 * (fresh install before seed ran). The caller's seed will create it; we don't
 * fail the run on a missing heartbeat row.
 */
export async function recordJobHeartbeat(
  prisma: PrismaLike,
  jobId: string,
  data: {
    lastStatus: string;
    lastError: string | null;
    lastRunAt?: Date;
    nextRunAt?: Date;
  },
): Promise<void> {
  await prisma.scheduledJob
    .update({
      where: { jobId },
      data: {
        lastStatus: data.lastStatus,
        lastError: data.lastError,
        ...(data.lastRunAt !== undefined ? { lastRunAt: data.lastRunAt } : {}),
        ...(data.nextRunAt !== undefined ? { nextRunAt: data.nextRunAt } : {}),
      },
    })
    .catch(() => {});
}

/**
 * Human-readable failure summary from a script outcome. Canonical home for
 * the `summarizeFailure` grammar every runner re-implemented: prefer the
 * structured trace failure line from the shell script (human-curated), fall
 * back to the last stderr line, then the exit code, then the engine fallback.
 */
export function summarizeScriptFailure(
  outcome: Pick<ScriptOutcome, "stderr" | "exitCode">,
  opts: {
    /** Marker the shell script prints on failure, e.g. "[backup-trace] failed:". */
    marker: string;
    /** Strips everything up to and including the marker. */
    strip: RegExp;
    /** "runner" for backups, "restore script" for restores. */
    exitLabel: string;
    /** Engine-specific no-diagnostic fallback text. */
    fallback: string;
  },
): string {
  const traceLine = outcome.stderr
    .split("\n")
    .reverse()
    .find((line) => line.includes(opts.marker));
  if (traceLine) {
    return traceLine.replace(opts.strip, "").trim();
  }
  const lastStderr = outcome.stderr.trim().split("\n").pop()?.trim() ?? "";
  if (lastStderr) return lastStderr.slice(0, 500);
  if (outcome.exitCode !== 0) return `${opts.exitLabel} exited ${outcome.exitCode}`;
  return opts.fallback;
}

async function readManifest(targetDir: string): Promise<AnyBackupManifest | null> {
  try {
    const raw = await fs.readFile(path.posix.join(targetDir, "manifest.json"), "utf-8");
    return JSON.parse(raw) as AnyBackupManifest;
  } catch {
    return null;
  }
}

async function pruneTargetDir(
  targetDir: string,
  trace: (...parts: unknown[]) => void,
): Promise<void> {
  try {
    await fs.rm(targetDir, { recursive: true, force: true });
  } catch (err) {
    trace("retention: could not delete", targetDir, err);
  }
}

async function computeRetainedStorageBytes(
  prisma: PrismaLike,
  target: BackupTarget,
): Promise<number> {
  const rows = await prisma.backupRun.findMany({
    where: { status: "ok", prunedAt: null, target },
    select: { sizeBytes: true },
  });
  return rows.reduce((sum, r) => sum + Number(r.sizeBytes ?? BigInt(0)), 0);
}

/**
 * Apply GFS retention for one target. Canonical home (was copy-pasted into
 * all three backup runners with only the `target` literal swapped).
 */
export async function applyRetention(
  prisma: PrismaLike,
  target: BackupTarget,
  policy: BackupRetentionPolicy,
  backupsRoot: string,
  trace: (...parts: unknown[]) => void,
): Promise<void> {
  const runs = await prisma.backupRun.findMany({
    where: { target },
    orderBy: { startedAt: "desc" },
  });

  const partition = partitionForRetention(
    runs.map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      prunedAt: r.prunedAt,
    })),
    policy,
  );

  // Only the runs that were eligible (ok + not-yet-pruned) but didn't make
  // the keep set need filesystem deletion. Failed/already-pruned go through
  // a metadata-only sweep (just to flip prunedAt for failed runs whose files
  // we never wrote, so the UI can hide them).
  const eligibleToPrune = partition.prune.filter(
    (r) => r.status === "ok" && r.prunedAt === null,
  );
  const failedSweep = partition.prune.filter(
    (r) => r.status === "failed" && r.prunedAt === null,
  );

  for (const run of eligibleToPrune) {
    const dbRow = runs.find((r) => r.id === run.id);
    if (!dbRow) continue;
    const absolute = path.posix.join(backupsRoot, dbRow.storagePath);
    await pruneTargetDir(absolute, trace);
  }

  if (eligibleToPrune.length > 0) {
    await prisma.backupRun.updateMany({
      where: { id: { in: eligibleToPrune.map((r) => r.id) } },
      data: { prunedAt: new Date() },
    });
  }
  if (failedSweep.length > 0) {
    await prisma.backupRun.updateMany({
      where: { id: { in: failedSweep.map((r) => r.id) } },
      data: { prunedAt: new Date() },
    });
  }

  trace(
    `retention applied kept=${partition.keep.length} pruned=${eligibleToPrune.length} failed_swept=${failedSweep.length}`,
  );
}

/**
 * Main entrypoint. Idempotent in the sense that each call produces a new
 * BackupRun row regardless of outcome; concurrent invocations are kept to one
 * at a time by the Inngest function's `concurrency: { limit: 1 }`.
 */
export async function runManagedBackup(
  spec: BackupEngineSpec,
  args: ManagedBackupArgs,
): Promise<{ runId: string; status: "ok" | "failed"; error?: string }> {
  const trace = (...parts: unknown[]) => {
    // eslint-disable-next-line no-console
    console.log(spec.traceTag, ...parts);
  };

  const now = args.now ?? (() => new Date());
  const startedAt = now();
  const trigger = args.trigger;
  const retention = args.retention ?? DEFAULT_BACKUP_RETENTION;
  const backupsRoot = args.backupsRoot ?? BACKUPS_ROOT;
  const scriptPath = args.scriptPath ?? resolveManagedScriptPath(spec.scriptName);
  const composeProject =
    args.composeProject ?? process.env.COMPOSE_PROJECT_NAME ?? "dpf";

  // Use the in-process Prisma client unless the caller injected a stub.
  const prisma = args.prismaClient ?? (await import("@dpf/db")).prisma;

  const tsKey = isoTsForDirectory(startedAt);
  const relativePath = `${spec.subdir}/${tsKey}`;
  const absoluteTargetDir = path.posix.join(backupsRoot, relativePath);

  trace(`run start trigger=${trigger} target=${absoluteTargetDir}`);

  // Create the BackupRun row up front in `running` state so the readiness
  // card surfaces an in-progress dump immediately. The runner has a hard
  // timeout so this can't sit `running` forever.
  const created = await prisma.backupRun.create({
    data: {
      target: spec.target,
      status: "running",
      trigger,
      schedule: trigger === "scheduled" ? spec.schedule : null,
      storagePath: relativePath,
      dpfVersion: process.env.DPF_VERSION ?? null,
    },
    select: { id: true },
  });

  await recordJobHeartbeat(prisma, spec.jobId, {
    lastRunAt: startedAt,
    lastStatus: "running",
    lastError: null,
  });

  // Ensure the parent /backups/<subdir> directory exists. The target itself
  // is created by the shell script.
  await fs.mkdir(path.posix.join(backupsRoot, spec.subdir), { recursive: true });

  const env = spec.buildEnv({ targetDir: absoluteTargetDir, composeProject });

  // Routes through the shared /bin/sh chokepoint so the script need not carry
  // the executable bit (which git-on-Windows + the Docker COPY both strip).
  const outcome = await runManagedScript(scriptPath, {
    env,
    timeoutMs: spec.timeoutMs,
  });
  const manifest = outcome.ok ? await readManifest(absoluteTargetDir) : null;
  const finishedAt = now();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  if (outcome.ok && manifest) {
    await prisma.backupRun.update({
      where: { id: created.id },
      data: {
        status: "ok",
        finishedAt,
        sizeBytes: BigInt(manifest.sizeBytes),
        durationMs,
        sha256: manifest.sha256,
        ...(spec.successRowExtras ? spec.successRowExtras(manifest) : {}),
      },
    });

    await recordJobHeartbeat(prisma, spec.jobId, {
      lastRunAt: startedAt,
      lastStatus: "ok",
      lastError: null,
      nextRunAt: nextDailyRunAt(finishedAt),
    });

    spec.metrics.runsTotal.inc({ status: "ok", trigger });
    spec.metrics.durationSeconds.observe({ trigger }, durationMs / 1000);
    spec.metrics.lastSuccessSeconds.set(Math.floor(finishedAt.getTime() / 1000));

    await applyRetention(prisma, spec.target, retention, backupsRoot, trace);

    const retainedBytes = await computeRetainedStorageBytes(prisma, spec.target);
    spec.metrics.storageBytes.set(retainedBytes);

    trace(
      `run ok id=${created.id} size=${manifest.sizeBytes} duration_ms=${durationMs}`,
    );
    return { runId: created.id, status: "ok" };
  }

  // Failure path. Capture as much diagnostic detail as we can without
  // surfacing CLI bits to the operator.
  const errorSummary = summarizeScriptFailure(outcome, {
    marker: spec.failureMarker,
    strip: spec.failureStrip,
    exitLabel: "runner",
    fallback: spec.failureFallback,
  });
  await prisma.backupRun.update({
    where: { id: created.id },
    data: {
      status: "failed",
      finishedAt,
      durationMs,
      errorMessage: errorSummary,
    },
  });

  await recordJobHeartbeat(prisma, spec.jobId, {
    lastRunAt: startedAt,
    lastStatus: "failed",
    lastError: errorSummary,
    nextRunAt: nextDailyRunAt(finishedAt),
  });

  spec.metrics.runsTotal.inc({ status: "failed", trigger });
  spec.metrics.durationSeconds.observe({ trigger }, durationMs / 1000);

  trace(`run failed id=${created.id} reason=${errorSummary}`);
  return { runId: created.id, status: "failed", error: errorSummary };
}
