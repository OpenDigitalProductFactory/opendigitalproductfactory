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

import { inngest } from "../inngest-client";
import { gateAtEntry } from "../quiescence-gates";

// Re-exported for callers and tests; the actual implementation lives below.
export const CONTRIBUTOR_INVENTORY_SYNC_JOB_ID = "contributor-inventory-sync";

// Cron interval in minutes; reaper threshold is 2× this value.
const CRON_INTERVAL_MIN = 10;
const STUCK_THRESHOLD_MS = 2 * CRON_INTERVAL_MIN * 60_000;

export type SyncSourceKey = "git-worktree" | "git-branch" | "github-pr";

export type SyncSourceResult =
  | { ok: true; rows: SnapshotRowPayload[] }
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
};

export type PerSourceSummary = {
  ok: boolean;
  count: number;
  error: string | null;
  state?: "ok" | "not-configured" | "error";
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

  // Heartbeat update — runner-owned fields only (does not touch metadata,
  // which is owned by Phase 4's GitHub etag persistence).
  await prisma.scheduledJob.update({
    where: { jobId: CONTRIBUTOR_INVENTORY_SYNC_JOB_ID },
    data: {
      lastRunAt: now,
      lastStatus: status,
      lastError:
        status === "failed"
          ? Object.values(perSourceResult)
              .map((r) => r.error)
              .filter(Boolean)
              .join("; ") || "all sources failed"
          : null,
      nextRunAt: new Date(now.getTime() + CRON_INTERVAL_MIN * 60_000),
    },
  });

  return {
    syncRunId,
    status,
    perSourceResult,
    insertedRows,
    reaped: reapStuckRuns ? reaped : undefined,
    durationMs,
  };
}

function summarize(res: SyncSourceResult): PerSourceSummary {
  if (res.ok) {
    return { ok: true, count: res.rows.length, error: null, state: "ok" };
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

  const cwd = process.cwd();
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
      // Phase 2 stub — replaced in Phase 4 by github-rest-reader.ts.
      return {
        ok: false,
        error: "github source not implemented yet (Phase 4)",
        state: "not-configured",
      };
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
    const gate = await gateAtEntry(step);
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
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };

    const triggeredBy =
      (event.data as { triggeredBy?: string } | undefined)?.triggeredBy ?? "mcp";

    return await step.run("run-sync-on-demand", () =>
      runContributorInventorySync({ triggeredBy, reapStuckRuns: false }),
    );
  },
);
