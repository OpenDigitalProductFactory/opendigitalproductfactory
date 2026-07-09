/**
 * Shared managed-restore engine (EP-8DC217EB BET-11, BI-B72328D5).
 *
 * `runManagedRestore(spec, args)` is the single implementation of the restore
 * lifecycle that postgres-restore-runner.ts, neo4j-restore-runner.ts and
 * qdrant-restore-runner.ts previously each carried:
 *
 *   1. Acquire the portal-side mutex (single restore at a time, any target).
 *   2. Verify the source artifact exists and its sha256 still matches what
 *      was recorded — catches on-disk corruption BEFORE the restore script
 *      touches the live store.
 *   3. Write a pre-restore safety backup (trigger="pre-restore-safety") via
 *      the engine's backup entry point.
 *   4. Spawn the engine's managed restore script.
 *   5. Record the BackupRestore audit row (sourceBackupRunId +
 *      preRestoreBackupRunId + status + duration). Postgres additionally
 *      re-inserts the audit rows the restore itself wiped (see the
 *      capture/reinsert hooks on its RestoreEngineSpec).
 *   6. Release the lock in finally.
 *
 * This file is also the canonical home of the restore lock + error types
 * (`acquireRestoreLock`, `isRestoreInFlight`, `RestoreLockedError`,
 * `RestoreIntegrityError`) which postgres-restore-runner.ts re-exports for
 * backward compatibility. One of the two canonical homes enforced by
 * scripts/check-no-local-backup-helper.mjs.
 *
 * Per the never-ask-user-to-run-commands kernel principle, this is only
 * ever invoked from the admin restore wizard's confirmRestore action with
 * a typed-RESTORE confirmation already verified (or from the governed
 * self-upgrade rollback, which holds the lock itself).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { summarizeScriptFailure, type PrismaLike } from "./managed-backup";
import { resolveManagedScriptPath, runManagedScript } from "./managed-script-path";
import type { RestoreEngineSpec } from "./engine-specs";

const BACKUPS_ROOT = "/backups";

/** Module-scoped portal mutex. Single Next.js server = single source of truth. */
let restoreLockHeld = false;
let restoreLockHolder: string | null = null;
let restoreLockAcquiredAt: Date | null = null;

export class RestoreLockedError extends Error {
  constructor(public readonly heldBy: string | null, public readonly since: Date | null) {
    super(
      since
        ? `A restore is already in progress (started ${since.toISOString()}). Wait for it to complete or fail.`
        : "A restore is already in progress.",
    );
    this.name = "RestoreLockedError";
  }
}

export class RestoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreIntegrityError";
  }
}

/**
 * Acquire the portal mutex. Throws RestoreLockedError if another restore
 * is already in flight. Returns a release function the caller MUST invoke
 * in `finally`.
 */
export function acquireRestoreLock(holder: string): () => void {
  if (restoreLockHeld) {
    throw new RestoreLockedError(restoreLockHolder, restoreLockAcquiredAt);
  }
  restoreLockHeld = true;
  restoreLockHolder = holder;
  restoreLockAcquiredAt = new Date();
  return () => {
    restoreLockHeld = false;
    restoreLockHolder = null;
    restoreLockAcquiredAt = null;
  };
}

/**
 * Inspect the lock state without acquiring. Used by the readiness card +
 * server actions that want to surface "restore in progress" to the operator.
 */
export function isRestoreInFlight(): {
  inFlight: boolean;
  holder: string | null;
  since: Date | null;
} {
  return {
    inFlight: restoreLockHeld,
    holder: restoreLockHolder,
    since: restoreLockAcquiredAt,
  };
}

/** Args shared by all three engine entry points (runPostgresRestore etc.). */
export interface ManagedRestoreArgs {
  sourceBackupRunId: string;
  /** User id who clicked confirm. Stored on BackupRestore for audit. */
  initiatedByUserId?: string | null;
  /** Restore trigger discriminator written to BackupRestore.trigger. */
  trigger?: string | null;
  /** Override backups root for tests. */
  backupsRoot?: string;
  /** Override restore script path for tests. */
  scriptPath?: string;
  /** Inject prisma for tests. */
  prismaClient?: PrismaLike;
  /** Inject clock for deterministic tests. */
  now?: () => Date;
  /**
   * Inject a custom safety-backup function for tests. Defaults to the
   * engine's backup entry point with trigger="pre-restore-safety".
   */
  takeSafetyBackup?: () => Promise<{ runId: string; status: "ok" | "failed" }>;
  /** Internal orchestration hook: caller already holds the shared restore lock. */
  acquireLock?: boolean;
}

async function fileSha256(absolutePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const fileHandle = await fs.open(absolutePath, "r");
  try {
    const stream = fileHandle.createReadStream();
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
  } finally {
    await fileHandle.close();
  }
  return hash.digest("hex");
}

export async function runManagedRestore(
  spec: RestoreEngineSpec,
  args: ManagedRestoreArgs,
): Promise<{ restoreId: string; status: "ok" | "failed" }> {
  const trace = (...parts: unknown[]) => {
    // CodeQL js/log-injection: parts may contain user-influenced values
    // (restore-job parameters). JSON.stringify each part neutralises CR/LF.
    // eslint-disable-next-line no-console
    console.log(
      `${spec.traceTag} %s`,
      parts.map((p) => JSON.stringify(p)).join(" "),
    );
  };
  const summarize = (outcome: { stderr: string; exitCode: number }) =>
    summarizeScriptFailure(outcome, {
      marker: spec.failureMarker,
      strip: spec.failureStrip,
      exitLabel: "restore script",
      fallback: spec.failureFallback,
    });

  const now = args.now ?? (() => new Date());
  const backupsRoot = args.backupsRoot ?? BACKUPS_ROOT;
  const scriptPath = args.scriptPath ?? resolveManagedScriptPath(spec.scriptName);
  const prisma = args.prismaClient ?? (await import("@dpf/db")).prisma;

  const release =
    args.acquireLock === false
      ? () => {}
      : acquireRestoreLock(args.sourceBackupRunId);
  const startedAt = now();
  trace(`acquired lock for source=${args.sourceBackupRunId}`);

  try {
    // ── 1. Resolve + integrity-check the source artifact ──────────────────
    const source = await prisma.backupRun.findUnique({
      where: { id: args.sourceBackupRunId },
    });
    if (!source) {
      throw new RestoreIntegrityError(
        `Source BackupRun ${args.sourceBackupRunId} not found.`,
      );
    }
    if (source.status !== "ok") {
      throw new RestoreIntegrityError(
        spec.messages.statusNotOk(args.sourceBackupRunId, source.status),
      );
    }
    if (source.prunedAt !== null) {
      throw new RestoreIntegrityError(spec.messages.pruned(args.sourceBackupRunId));
    }
    if (spec.messages.wrongTarget && source.target !== spec.target) {
      throw new RestoreIntegrityError(spec.messages.wrongTarget(source.target));
    }

    const artifactPath = path.posix.join(
      backupsRoot,
      source.storagePath,
      spec.artifactFileName,
    );
    try {
      await fs.access(artifactPath);
    } catch {
      throw new RestoreIntegrityError(spec.messages.missingArtifact(artifactPath));
    }

    if (source.sha256) {
      const actual = await fileSha256(artifactPath);
      if (actual !== source.sha256) {
        throw new RestoreIntegrityError(
          spec.messages.checksumMismatch(source.sha256, actual),
        );
      }
    }

    // ── 2. Pre-restore safety backup ──────────────────────────────────────
    trace(spec.messages.safetyStartTrace);
    const safetyTake = args.takeSafetyBackup
      ? args.takeSafetyBackup
      : () => spec.takeSafetyBackup({ backupsRoot, prisma });
    const safety = await safetyTake();
    if (safety.status !== "ok") {
      throw new RestoreIntegrityError(spec.messages.safetyFailed);
    }
    trace(spec.messages.safetyOkTrace(safety.runId));

    // Engine hook: Postgres snapshots the safety BackupRun row in MEMORY here
    // because pg_restore --clean wipes every table (including the audit rows
    // we just wrote); Neo4j/Qdrant leave Postgres untouched and skip this.
    const preState = spec.capturePreRestoreState
      ? await spec.capturePreRestoreState({ prisma, safetyRunId: safety.runId })
      : null;

    // ── 3. Run the restore script ─────────────────────────────────────────
    const env = spec.buildEnv({ dumpPath: artifactPath });
    // Routes through the shared /bin/sh chokepoint so the script need not
    // carry the executable bit (which git-on-Windows + Docker COPY strip).
    const outcome = await runManagedScript(scriptPath, {
      env,
      timeoutMs: spec.timeoutMs,
    });
    const finishedAt = now();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    // ── 4. Record audit rows ──────────────────────────────────────────────
    // Postgres re-inserts the source + safety BackupRun rows the restore
    // wiped (see engine-specs.ts); the other engines' hook is undefined.
    if (spec.reinsertAuditRows) {
      await spec.reinsertAuditRows({ prisma, source, preState });
    }

    const created = await prisma.backupRestore.create({
      data: {
        startedAt,
        finishedAt,
        status: outcome.ok ? "ok" : "failed",
        trigger: args.trigger ?? null,
        sourceBackupRunId: source.id,
        preRestoreBackupRunId: safety.runId,
        initiatedByUserId: args.initiatedByUserId ?? null,
        errorMessage: outcome.ok ? null : summarize(outcome),
      },
      select: { id: true },
    });

    if (outcome.ok) {
      spec.metrics?.runsTotal.inc({ status: "ok" });
      spec.metrics?.durationSeconds.observe(durationMs / 1000);
      trace(`restore ok id=${created.id} duration_ms=${durationMs}`);
      return { restoreId: created.id, status: "ok" };
    }

    spec.metrics?.runsTotal.inc({ status: "failed" });
    spec.metrics?.durationSeconds.observe(durationMs / 1000);
    trace(`restore failed id=${created.id} reason=${summarize(outcome)}`);
    return { restoreId: created.id, status: "failed" };
  } finally {
    release();
    trace("released lock");
  }
}

// Test-only exports (re-exported by postgres-restore-runner.ts so existing
// tests keep importing from the historical location).
export const __test__ = {
  acquireRestoreLock,
  resetLockForTest: () => {
    restoreLockHeld = false;
    restoreLockHolder = null;
    restoreLockAcquiredAt = null;
  },
};
