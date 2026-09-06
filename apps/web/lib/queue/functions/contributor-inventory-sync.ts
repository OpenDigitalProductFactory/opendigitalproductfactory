/**
 * Contributor inventory sync — Phase 2 + Phase 4 of
 * docs/superpowers/plans/2026-05-26-contributor-inventory-sync.md.
 * Spec: docs/superpowers/specs/2026-05-26-contributor-inventory-sync-design.md
 *
 * Two Inngest functions share one `runContributorInventorySync` runner:
 *   - contributorInventorySyncCron     — triggers: [cron("*\/10 * * * *")]
 *   - contributorInventorySyncOnDemand — triggers: [{ event: "ops/contributor-inventory-sync.run" }]
 *
 * Both use `concurrency: { limit: 1, scope: "fn" }` (matching every other
 * function in this directory). Cross-function collision is safe because:
 *
 *   - Each run generates its own `syncRunId`.
 *   - `ContributorInventorySnapshot` rows are uniquely keyed on
 *     `(source, sourceKey, syncRunId)` — no row corruption on overlap.
 *   - The read model resolves per-source from the latest successful run,
 *     not from a single "most recent run."
 *
 * Stuck-run reaping runs from the cron function ONLY. On-demand runs do
 * not reap because they can race with an in-flight cron run.
 *
 * GitHub source is stubbed in Phase 2 and replaced by the real
 * `github-rest-reader.ts` in Phase 4.
 */

import { cron } from "inngest";

import {
  CONTRIBUTOR_INVENTORY_JOB_ID,
  CONTRIBUTOR_INVENTORY_JOB_NAME,
  CONTRIBUTOR_INVENTORY_SCHEDULE,
} from "@dpf/db";

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// Re-exported for callers and tests; mirrors the canonical seed-side constant
// so the runner and seed cannot drift on the jobId string.
export const CONTRIBUTOR_INVENTORY_SYNC_JOB_ID = CONTRIBUTOR_INVENTORY_JOB_ID;

// Cron interval in minutes; reaper threshold is 2× this value.
const CRON_INTERVAL_MIN = 10;
const STUCK_THRESHOLD_MS = 2 * CRON_INTERVAL_MIN * 60_000;

// Phase 6 — retention + notifications. Spec §"Cleanup strategy" /
// §"Operator notifications".
const RETENTION_WINDOW_DAYS = 7;
const RETENTION_WINDOW_MS = RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const PROLONGED_FAILURE_RUN_COUNT = 6;
const STALE_CRON_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const NOTIFICATION_GITHUB_CATEGORY = "contributor-inventory-github";
const NOTIFICATION_CRON_CATEGORY = "contributor-inventory-cron";
const NOTIFICATION_GITHUB_SUBJECT = "github-pr-sync";
const NOTIFICATION_CRON_SUBJECT = "contributor-inventory-sync";

export type SyncSourceKey = "git-worktree" | "git-branch" | "github-pr";

export type SyncSourceResult =
  | { ok: true; rows: SnapshotRowPayload[]; unchanged?: boolean }
  | { ok: false; error: string; state?: "not-configured" | "error" };

export type SnapshotRowPayload = {
  sourceKey: string;
  payload: unknown;
};

export type SyncSourceReaders = {
  worktree: () => Promise<SyncSourceResult>;
  branch: () => Promise<SyncSourceResult>;
  githubPr: () => Promise<SyncSourceResult>;
};

export function resolveContributorInventoryGitCwd({
  env = process.env,
  cwd = process.cwd(),
}: {
  env?: Record<string, string | undefined>;
  cwd?: string;
} = {}): string {
  const repoRoot = env.DPF_REPO_ROOT?.trim();
  return repoRoot || cwd;
}

export type RunSyncOptions = {
  triggeredBy?: "cron" | "mcp" | "ui" | string;
  reapStuckRuns?: boolean;
  now?: Date;
  readers?: SyncSourceReaders;
};

export type RunSyncResult = {
  syncRunId: string;
  status: "completed" | "partial" | "failed";
  perSourceResult: Record<SyncSourceKey, PerSourceSummary>;
  insertedRows: number;
  reaped?: number;
  durationMs: number;
  /** Phase 6 — rows deleted by the retention sweep; undefined if cleanup failed or was skipped. */
  cleanupDeletedRuns?: number;
  /** Phase 6 — notifications written this run (one new row per category that flipped state). */
  notificationsCreated?: number;
  /** Phase 6 — notifications resolved (set resolvedAt) this run. */
  notificationsResolved?: number;
};

export type PerSourceSummary = {
  ok: boolean;
  count: number;
  error: string | null;
  state?: "ok" | "not-configured" | "error";
  /** The provider authenticated that its previously stored representation is current. */
  unchanged?: boolean;
};

/**
 * Pure runner — no Inngest dependency, no shell-out unless the default
 * reader factory is used. Tests inject fake `readers`.
 */
export async function runContributorInventorySync(
  options: RunSyncOptions = {},
): Promise<RunSyncResult> {
  const { prisma } = await import("@dpf/db");
  const now = options.now ?? new Date();
  const triggeredBy = options.triggeredBy ?? "cron";
  const reapStuckRuns = options.reapStuckRuns ?? false;
  const readers = options.readers ?? (await createDefaultReaders());

  let reaped = 0;
  if (reapStuckRuns) {
    const cutoff = new Date(now.getTime() - STUCK_THRESHOLD_MS);
    const result = await prisma.contributorInventorySyncRun.updateMany({
      where: {
        status: "running",
        startedAt: { lt: cutoff },
      },
      data: {
        status: "failed",
        completedAt: now,
      },
    });
    reaped = result.count;
  }

  // Generate the run id and write the audit row. `syncRunId` is the
  // string the snapshot rows FK to via ON DELETE CASCADE.
  const runRow = await prisma.contributorInventorySyncRun.create({
    data: {
      syncRunId: cuid(),
      status: "running",
      triggeredBy,
      startedAt: now,
    },
    select: { syncRunId: true },
  });
  const syncRunId = runRow.syncRunId;

  // Run three readers in parallel — failure is per-source, not global.
  const [worktreeRes, branchRes, githubRes] = await Promise.all([
    safeRead(readers.worktree),
    safeRead(readers.branch),
    safeRead(readers.githubPr),
  ]);

  const perSourceResult: Record<SyncSourceKey, PerSourceSummary> = {
    "git-worktree": summarize(worktreeRes),
    "git-branch": summarize(branchRes),
    "github-pr": summarize(githubRes),
  };

  const successful: { source: SyncSourceKey; rows: SnapshotRowPayload[] }[] = [];
  if (worktreeRes.ok) successful.push({ source: "git-worktree", rows: worktreeRes.rows });
  if (branchRes.ok) successful.push({ source: "git-branch", rows: branchRes.rows });
  if (githubRes.ok) successful.push({ source: "github-pr", rows: githubRes.rows });

  let insertedRows = 0;
  for (const bucket of successful) {
    if (bucket.rows.length === 0) continue;
    const created = await prisma.contributorInventorySnapshot.createMany({
      data: bucket.rows.map((row) => ({
        source: bucket.source,
        sourceKey: row.sourceKey,
        payload: row.payload as never,
        syncRunId,
        fetchedAt: now,
      })),
      skipDuplicates: true,
    });
    insertedRows += created.count;
  }

  const okCount = [worktreeRes, branchRes, githubRes].filter((r) => r.ok).length;
  const status: "completed" | "partial" | "failed" =
    okCount === 3 ? "completed" : okCount === 0 ? "failed" : "partial";

  const durationMs = Date.now() - now.getTime();

  await prisma.contributorInventorySyncRun.update({
    where: { syncRunId },
    data: {
      status,
      completedAt: new Date(),
      durationMs,
      perSourceResult: perSourceResult as never,
    },
  });

  // Heartbeat upsert — runner-owned fields only (does not touch metadata,
  // which is owned by Phase 4's GitHub etag persistence). Upsert (not update)
  // because upgrade installs that skip `pnpm db seed` leave the heartbeat row
  // missing; a plain update would throw P2025 RecordNotFound on the first
  // cron tick. Create + update branches set identical runner-owned fields;
  // jobId/name/schedule come from the @dpf/db seed constants so the two
  // sides cannot drift.
  const lastError =
    status === "failed"
      ? Object.values(perSourceResult)
          .map((r) => r.error)
          .filter(Boolean)
          .join("; ") || "all sources failed"
      : null;
  const nextRunAt = new Date(now.getTime() + CRON_INTERVAL_MIN * 60_000);
  // Capture lastRunAt BEFORE the upsert so the stale-cron check below can
  // see how long the previous run was ago — useful for "cron resumed after
  // a gap" notifications.
  const priorHeartbeat = await prisma.scheduledJob.findUnique({
    where: { jobId: CONTRIBUTOR_INVENTORY_JOB_ID },
    select: { lastRunAt: true },
  });
  await prisma.scheduledJob.upsert({
    where: { jobId: CONTRIBUTOR_INVENTORY_JOB_ID },
    create: {
      jobId: CONTRIBUTOR_INVENTORY_JOB_ID,
      name: CONTRIBUTOR_INVENTORY_JOB_NAME,
      schedule: CONTRIBUTOR_INVENTORY_SCHEDULE,
      lastRunAt: now,
      lastStatus: status,
      lastError,
      nextRunAt,
    },
    update: {
      lastRunAt: now,
      lastStatus: status,
      lastError,
      nextRunAt,
    },
  });

  // Phase 6 — retention + notifications. Each is wrapped in its own try/catch
  // so a cleanup or notification failure does not fail the run as a whole.
  // Spec §"Cleanup strategy" / §"Operator notifications".
  let cleanupDeletedRuns: number | undefined;
  let notificationsCreated = 0;
  let notificationsResolved = 0;

  try {
    cleanupDeletedRuns = await runRetentionSweep(now);
  } catch (err) {
    // Cleanup failure is logged but does not break the cron — the next tick
    // will retry, and the read path is unaffected by stale rows.
    console.warn(
      "[contributor-inventory-sync] retention sweep failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    const githubResult = await syncGithubFailureNotification(now);
    notificationsCreated += githubResult.created;
    notificationsResolved += githubResult.resolved;
  } catch (err) {
    console.warn(
      "[contributor-inventory-sync] github notification sync failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    const cronResult = await syncStaleCronNotification(
      now,
      priorHeartbeat?.lastRunAt ?? null,
    );
    notificationsCreated += cronResult.created;
    notificationsResolved += cronResult.resolved;
  } catch (err) {
    console.warn(
      "[contributor-inventory-sync] cron heartbeat notification sync failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  return {
    syncRunId,
    status,
    perSourceResult,
    insertedRows,
    reaped: reapStuckRuns ? reaped : undefined,
    durationMs,
    cleanupDeletedRuns,
    notificationsCreated,
    notificationsResolved,
  };
}

// ─── Phase 6 helpers: retention + notifications ─────────────────────────────

/**
 * Retention sweep — delete ContributorInventorySyncRun rows older than the
 * 7-day window EXCEPT those that are the latest-successful for any of the
 * three snapshot sources. The schema has ON DELETE CASCADE from
 * ContributorInventorySnapshot.syncRunId so the snapshot rows go with their
 * run row atomically.
 *
 * The preservation guard defends against the "cron has been broken for
 * >7 days" failure mode: even an ancient snapshot stays around as long as
 * it's still the freshest the dashboard has, so the page never goes blank
 * after a long outage. Spec §"Cleanup strategy".
 *
 * Returns the count of run rows actually deleted (cascade-delete on
 * snapshot rows is implicit).
 */
async function runRetentionSweep(now: Date): Promise<number> {
  const { prisma } = await import("@dpf/db");
  const cutoff = new Date(now.getTime() - RETENTION_WINDOW_MS);

  // Find the latest-successful syncRunId per source. At most three.
  const sources: SyncSourceKey[] = ["git-worktree", "git-branch", "github-pr"];
  const preserveSet = new Set<string>();
  for (const source of sources) {
    const row = await prisma.contributorInventorySyncRun.findFirst({
      where: { perSourceResult: { path: [source, "ok"], equals: true } },
      orderBy: { startedAt: "desc" },
      select: { syncRunId: true },
    });
    if (row) preserveSet.add(row.syncRunId);
  }

  const result = await prisma.contributorInventorySyncRun.deleteMany({
    where: {
      startedAt: { lt: cutoff },
      syncRunId: { notIn: Array.from(preserveSet) },
    },
  });
  return result.count;
}

/**
 * Prolonged-GitHub-failure notification.
 *
 * Looks at the most recent N completed runs. If the GitHub source was NOT
 * ok in EVERY one of those runs, fire a warning notification (idempotent via
 * the existing-row check). If GitHub was ok in ANY of those runs, resolve
 * any open notification.
 *
 * The `not-configured` state (no credential bound) does NOT count as a
 * failure — that's the normal customer-install posture. Spec
 * §"Operator notifications" point 3.
 *
 * Returns the count of notifications created and resolved this run.
 */
async function syncGithubFailureNotification(
  now: Date,
): Promise<{ created: number; resolved: number }> {
  const { prisma } = await import("@dpf/db");

  const recentRuns = await prisma.contributorInventorySyncRun.findMany({
    where: { status: { in: ["completed", "partial"] } },
    orderBy: { startedAt: "desc" },
    take: PROLONGED_FAILURE_RUN_COUNT,
    select: { perSourceResult: true },
  });

  if (recentRuns.length < PROLONGED_FAILURE_RUN_COUNT) {
    // Not enough history yet — neither fire nor resolve.
    return { created: 0, resolved: 0 };
  }

  const allFailed = recentRuns.every((r) => {
    const psr = (r.perSourceResult ?? {}) as Record<
      string,
      { ok?: boolean; state?: string }
    >;
    const gh = psr["github-pr"];
    // not-configured is NOT a failure — operator hasn't connected GitHub
    // and we should not nag them about it.
    if (gh?.state === "not-configured") return false;
    return gh?.ok === false;
  });

  if (allFailed) {
    const existing = await prisma.platformNotification.findFirst({
      where: {
        category: NOTIFICATION_GITHUB_CATEGORY,
        subjectId: NOTIFICATION_GITHUB_SUBJECT,
        resolvedAt: null,
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing && existing.severity === "warning") {
      return { created: 0, resolved: 0 }; // idempotent — same tier
    }
    if (existing) {
      await prisma.platformNotification.updateMany({
        where: {
          category: NOTIFICATION_GITHUB_CATEGORY,
          subjectId: NOTIFICATION_GITHUB_SUBJECT,
          resolvedAt: null,
        },
        data: { resolvedAt: now },
      });
    }
    await prisma.platformNotification.create({
      data: {
        severity: "warning",
        category: NOTIFICATION_GITHUB_CATEGORY,
        subjectId: NOTIFICATION_GITHUB_SUBJECT,
        message:
          "GitHub inventory sync has been failing for over an hour. Reconnect on the Contributor MCP card.",
      },
    });
    return { created: 1, resolved: existing ? 1 : 0 };
  }

  // GitHub succeeded in at least one of the most recent N runs — resolve any
  // open notification.
  const resolved = await prisma.platformNotification.updateMany({
    where: {
      category: NOTIFICATION_GITHUB_CATEGORY,
      subjectId: NOTIFICATION_GITHUB_SUBJECT,
      resolvedAt: null,
    },
    data: { resolvedAt: now },
  });
  return { created: 0, resolved: resolved.count };
}

/**
 * Stale-cron-heartbeat notification.
 *
 * If the previous `ScheduledJob.lastRunAt` was more than 2 hours ago, fire a
 * critical notification — the cron resumed after a gap. If it was recent
 * (or the heartbeat row didn't exist before this run, meaning we're on a
 * fresh install), resolve any open notification.
 *
 * The check is done against the PRIOR lastRunAt captured before the upsert.
 * That makes "cron has been silent for hours and just woke up" detectable.
 *
 * A truly silent cron (one that's never running) cannot fire its own
 * notification from inside this runner — that's an external-watcher concern
 * deliberately scoped out of this slice. Spec §"Operator notifications"
 * point 2.
 */
async function syncStaleCronNotification(
  now: Date,
  priorLastRunAt: Date | null,
): Promise<{ created: number; resolved: number }> {
  const { prisma } = await import("@dpf/db");

  const gapMs = priorLastRunAt ? now.getTime() - priorLastRunAt.getTime() : 0;
  const isStale = priorLastRunAt !== null && gapMs > STALE_CRON_THRESHOLD_MS;

  const existing = await prisma.platformNotification.findFirst({
    where: {
      category: NOTIFICATION_CRON_CATEGORY,
      subjectId: NOTIFICATION_CRON_SUBJECT,
      resolvedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (isStale) {
    if (existing && existing.severity === "critical") {
      return { created: 0, resolved: 0 }; // idempotent
    }
    if (existing) {
      await prisma.platformNotification.updateMany({
        where: {
          category: NOTIFICATION_CRON_CATEGORY,
          subjectId: NOTIFICATION_CRON_SUBJECT,
          resolvedAt: null,
        },
        data: { resolvedAt: now },
      });
    }
    const gapMinutes = Math.round(gapMs / 60_000);
    await prisma.platformNotification.create({
      data: {
        severity: "critical",
        category: NOTIFICATION_CRON_CATEGORY,
        subjectId: NOTIFICATION_CRON_SUBJECT,
        message: `Contributor inventory cron resumed after a ${gapMinutes}-minute gap. Check Inngest health.`,
      },
    });
    return { created: 1, resolved: existing ? 1 : 0 };
  }

  // Fresh / no-prior-run / recent — resolve any open notification.
  if (existing) {
    await prisma.platformNotification.updateMany({
      where: {
        category: NOTIFICATION_CRON_CATEGORY,
        subjectId: NOTIFICATION_CRON_SUBJECT,
        resolvedAt: null,
      },
      data: { resolvedAt: now },
    });
    return { created: 0, resolved: 1 };
  }
  return { created: 0, resolved: 0 };
}

function summarize(res: SyncSourceResult): PerSourceSummary {
  if (res.ok) {
    return {
      ok: true,
      count: res.rows.length,
      error: null,
      state: "ok",
      ...(res.unchanged ? { unchanged: true } : {}),
    };
  }
  return {
    ok: false,
    count: 0,
    error: res.error,
    state: res.state ?? "error",
  };
}

async function safeRead(
  reader: () => Promise<SyncSourceResult>,
): Promise<SyncSourceResult> {
  try {
    return await reader();
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? "reader threw" };
  }
}

// ─── Default readers (production wiring) ────────────────────────────────────

async function createDefaultReaders(): Promise<SyncSourceReaders> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const {
    parseGitWorktreeList,
    parseGitBranchList,
  } = await import("@/lib/contributor-change-lanes/git-inventory");

  const cwd = resolveContributorInventoryGitCwd();
  const TIMEOUT_MS = 8_000;
  const MAX_BUFFER = 4 * 1024 * 1024;

  return {
    worktree: async () => {
      const { stdout } = await execFileAsync(
        "git",
        ["worktree", "list", "--porcelain"],
        { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      );
      const parsed = parseGitWorktreeList(stdout);
      return {
        ok: true,
        rows: parsed.map((p) => ({ sourceKey: p.path, payload: p })),
      };
    },
    branch: async () => {
      const { stdout } = await execFileAsync(
        "git",
        [
          "for-each-ref",
          "--format=%(refname)\t%(objectname)\t%(committerdate:iso-strict)\t%(if)%(upstream:trackshort)%(then)%(else)%(end)",
          "refs/remotes/origin/",
        ],
        { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      );
      const parsed = parseGitBranchList(stdout, { remote: "origin" });
      return {
        ok: true,
        rows: parsed.map((p) => ({ sourceKey: p.name, payload: p })),
      };
    },
    githubPr: async () => {
      const { readGithubPullRequests } = await import(
        "@/lib/contributor-change-lanes/github-rest-reader"
      );
      const result = await readGithubPullRequests();
      if (!result.ok) {
        return { ok: false, error: result.error, state: result.state };
      }
      return { ok: true, rows: result.rows, unchanged: result.unchanged };
    },
  };
}

// Minimal cuid generator. We avoid pulling in the @paralleldrive/cuid2 module
// because Prisma's runtime generates the default-cuid id field for us; this
// is the user-facing `syncRunId` string that needs to be unique and stable.
function cuid(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 12);
  return `civs_${t}_${r}`;
}

// ─── Inngest function wrappers ──────────────────────────────────────────────

export const contributorInventorySyncCron = inngest.createFunction(
  {
    id: "ops/contributor-inventory-sync-cron",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [cron("*/10 * * * *")],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, "ops/contributor-inventory-sync-cron");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    return await step.run("run-sync-cron", () =>
      runContributorInventorySync({ triggeredBy: "cron", reapStuckRuns: true }),
    );
  },
);

export const contributorInventorySyncOnDemand = inngest.createFunction(
  {
    id: "ops/contributor-inventory-sync-on-demand",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: "ops/contributor-inventory-sync.run" }],
  },
  async ({ event, step }) => {
    const gate = await gateAtEntry(step, "ops/contributor-inventory-sync-on-demand");
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    const triggeredBy =
      (event.data as { triggeredBy?: string } | undefined)?.triggeredBy ?? "mcp";

    return await step.run("run-sync-on-demand", () =>
      runContributorInventorySync({ triggeredBy, reapStuckRuns: false }),
    );
  },
);
