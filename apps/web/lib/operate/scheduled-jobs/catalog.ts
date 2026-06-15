// BI-5A42E572 / EP-PROACTIVE-OPS — Scheduled Jobs admin surface.
//
// Static catalog that unifies the two scheduled-job registries for the admin
// view:
//   1. Code-defined Inngest crons — the `scheduledFunctions` array in
//      apps/web/lib/queue/functions/index.ts. Their cadence lives in code
//      (`triggers: [cron("…")]`), so it is reviewable but not runtime-tunable.
//   2. Data-driven ScheduledJob rows — Postgres rows that carry live run data
//      (lastRunAt / nextRunAt / lastStatus). Only a subset of crons maintain a
//      row today; `tracksRunData` marks which.
//
// This catalog is the AUTHORITATIVE classification source (core-locked vs
// editable) for known jobs; the ScheduledJob.category/locked columns persist
// classification for any row that has no catalog entry plus audited overrides.
//
// Why a hand-maintained list rather than reflection over `scheduledFunctions`:
// the Inngest function objects do not expose their cron string or a stable
// human label at runtime, and "is this job essential to platform integrity?"
// is a governance judgement that belongs in reviewed code, not inferred.
// When a new cron is added to scheduledFunctions, add it here too — the
// catalog drift test (scheduled-jobs.test.ts) fails the build otherwise.

import { CODE_GRAPH_JOB_ID } from "@/lib/integrate/code-graph/constants";

/** core = platform-integrity cron, operator read-only. editable = cadence
 *  may be tuned by an operator after install. */
export type JobCategory = "core" | "editable";

export interface ScheduledJobCatalogEntry {
  /** Join key against ScheduledJob.jobId. For crons that maintain a row this
   *  IS that row's jobId; for the rest it is a stable synthetic id (an
   *  edit/enable upserts a row under this id on first mutation). */
  jobId: string;
  /** The Inngest function id (id passed to inngest.createFunction). */
  inngestId: string;
  /** Human-readable job name. */
  name: string;
  /** One-line purpose — what breaks if this never runs. */
  purpose: string;
  /** Raw cron expression as defined in code. */
  cron: string;
  /** Human cadence label for display (derived from `cron`). */
  cadence: string;
  category: JobCategory;
  /** True when a ScheduledJob row carries live run data for this job. */
  tracksRunData: boolean;
  /** Inngest event name that triggers a one-shot manual run, or null when no
   *  manual-trigger event function exists for this job. */
  runNowEvent: string | null;
}

// Ordered roughly by operational prominence. core-locked jobs first.
export const SCHEDULED_JOB_CATALOG: readonly ScheduledJobCatalogEntry[] = [
  {
    jobId: CODE_GRAPH_JOB_ID, // "code-graph-reconcile"
    inngestId: "ops/code-graph-reconcile-scheduled",
    name: "Code graph reconcile",
    purpose:
      "Keeps the code-intelligence graph in sync with the repo. If it stops, code search / impact analysis silently go stale (the 13-day outage that motivated this surface).",
    cron: "*/15 * * * *",
    cadence: "Every 15 minutes",
    category: "core",
    tracksRunData: true,
    runNowEvent: "ops/code-graph.reconcile",
  },
  {
    jobId: "self-upgrade",
    inngestId: "ops/self-upgrade-scheduled",
    name: "Self-upgrade reconcile",
    purpose:
      "Autonomous deployment of merged main PRs to this install. Core to keeping the platform current.",
    cron: "nightly",
    cadence: "Nightly",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "postgres-daily-backup",
    inngestId: "ops/postgres-daily-backup-scheduled",
    name: "Postgres daily backup",
    purpose:
      "Durable Postgres backup. Disaster-recovery floor — never disable on a real install.",
    cron: "daily",
    cadence: "Daily",
    category: "core",
    tracksRunData: true,
    runNowEvent: "ops/postgres-backup.requested",
  },
  {
    jobId: "all-backups-daily",
    inngestId: "ops/all-backups-daily-scheduled",
    name: "All backups (fan-out)",
    purpose: "Fans out daily backups across Postgres / Neo4j / Qdrant sub-runners.",
    cron: "daily",
    cadence: "Daily",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "model-discovery-refresh",
    inngestId: "inference/model-discovery-refresh",
    name: "Model discovery refresh",
    purpose:
      "Refreshes the provider model catalog routing depends on. Stale data degrades model selection.",
    cron: "0 3 * * *",
    cadence: "Daily at 03:00",
    category: "core",
    tracksRunData: true,
    runNowEvent: null,
  },
  {
    jobId: "contributor-inventory-sync",
    inngestId: "ops/contributor-inventory-sync-cron",
    name: "Contributor inventory sync",
    purpose:
      "Reconciles contributor/PR inventory against GitHub. Governance + attribution integrity.",
    cron: "*/10 * * * *",
    cadence: "Every 10 minutes",
    category: "core",
    tracksRunData: true,
    runNowEvent: null,
  },
  {
    jobId: "agent-task-dispatch",
    inngestId: "agent/task-dispatch",
    name: "Agent task dispatch",
    purpose: "Pumps queued agent tasks into execution. Agent work stalls if it stops.",
    cron: "*/5 * * * *",
    cadence: "Every 5 minutes",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "taskrun-watchdog",
    inngestId: "ops/taskrun-watchdog",
    name: "Task-run watchdog",
    purpose: "Detects and resolves stuck task runs. Liveness guard for the task system.",
    cron: "* * * * *",
    cadence: "Every minute",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "token-expiry-monitor",
    inngestId: "ops/token-expiry-monitor",
    name: "Token expiry monitor",
    purpose: "Warns before provider/integration credentials expire. Auth continuity.",
    cron: "0 9 * * *",
    cadence: "Daily at 09:00",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "runtime-target-janitor",
    inngestId: "ops/runtime-target-janitor",
    name: "Runtime-target janitor",
    purpose: "Sweeps stale runtime targets + expires leases. Resource hygiene.",
    cron: "0 * * * *",
    cadence: "Hourly",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "infra-prune",
    inngestId: "ops/infra-prune",
    name: "Infrastructure prune",
    purpose: "Weekly reclamation of stale infra. Destructive — kept core-locked.",
    cron: "0 3 * * 0",
    cadence: "Weekly, Sun 03:00",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  // ── Editable (operationally tunable) ──────────────────────────────────────
  {
    jobId: "data-retention-sweep",
    inngestId: "ops/data-retention-sweep-scheduled",
    name: "Data retention sweep",
    purpose:
      "Purges aged operational logs, AI telemetry, and inactive coworker chat so the database does not grow without bound. Regulated records (financial, tax, compliance, licensing, HR, consent) are never auto-purged. Editable so an operator can disable or run-now this destructive sweep.",
    cron: "0 4 * * *",
    cadence: "Daily at 04:00",
    category: "editable",
    tracksRunData: true,
    runNowEvent: "ops/data-retention.requested",
  },
  {
    jobId: "discovery-prometheus-poll",
    inngestId: "ops/prometheus-poll",
    name: "Discovery: Prometheus poll",
    purpose: "Polls Prometheus for new monitoring targets. Cadence is tunable to taste.",
    cron: "0 * * * *",
    cadence: "Hourly",
    category: "editable",
    tracksRunData: true,
    runNowEvent: null,
  },
  {
    jobId: "discovery-full-sweep",
    inngestId: "ops/full-discovery-sweep",
    name: "Discovery: full sweep",
    purpose: "Full infrastructure discovery sweep. Cadence is tunable.",
    cron: "0 * * * *",
    cadence: "Hourly",
    category: "editable",
    tracksRunData: true,
    runNowEvent: null,
  },
  {
    jobId: "issue-report-triage",
    inngestId: "quality/issue-report-triage",
    name: "Quality: issue-report triage",
    purpose: "Triages inbound issue reports into the backlog. Cadence is tunable.",
    cron: "*/15 * * * *",
    cadence: "Every 15 minutes",
    category: "editable",
    tracksRunData: true,
    runNowEvent: null,
  },
  {
    jobId: "backlog-triage-drain",
    inngestId: "ops/backlog-triage-drain",
    name: "Backlog triage drain",
    purpose: "Drains the backlog triage queue. Cadence is tunable.",
    cron: "23 * * * *",
    cadence: "Hourly at :23",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "coworker-regression-detect",
    inngestId: "quality/coworker-regression-detect",
    name: "Coworker regression detect",
    purpose: "Scans for coworker quality regressions. Cadence is tunable.",
    cron: "*/15 * * * *",
    cadence: "Every 15 minutes",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "governed-backlog-tee-up",
    inngestId: "build/governed-backlog-tee-up-scheduled",
    name: "Governed backlog tee-up",
    purpose: "Tees up governed backlog items for the day. Cadence is tunable.",
    cron: "0 14 * * *",
    cadence: "Daily at 14:00",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "material-freshness-decay",
    inngestId: "decision/material-freshness-decay",
    name: "Material freshness decay",
    purpose: "Decays stale decision materials. Cadence is tunable.",
    cron: "0 3 * * *",
    cadence: "Daily at 03:00",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "research-schedule-scan",
    inngestId: "research/schedule-scan",
    name: "Research schedule scan",
    purpose: "Proposes scheduled research for the week. Cadence is tunable.",
    cron: "0 9 * * 1",
    cadence: "Weekly, Mon 09:00",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "wiki-lint",
    inngestId: "wiki/lint-daily",
    name: "Wiki lint",
    purpose: "Daily wiki integrity lint. Cadence is tunable.",
    cron: "30 3 * * *",
    cadence: "Daily at 03:30",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "skill-metrics-aggregator",
    inngestId: "skills/metrics-aggregator",
    name: "Skill metrics aggregator",
    purpose: "Aggregates skill-usage metrics. Cadence is tunable.",
    cron: "0 5 * * *",
    cadence: "Daily at 05:00",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "skill-curator",
    inngestId: "skills/curator",
    name: "Skill curator",
    purpose: "Curates / proposes skill improvements. Cadence is tunable.",
    cron: "0 7 * * *",
    cadence: "Daily at 07:00",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
] as const;

const CATALOG_BY_JOB_ID = new Map<string, ScheduledJobCatalogEntry>(
  SCHEDULED_JOB_CATALOG.map((e) => [e.jobId, e]),
);

export function getCatalogEntry(jobId: string): ScheduledJobCatalogEntry | undefined {
  return CATALOG_BY_JOB_ID.get(jobId);
}

/** A job is locked (operator read-only) when its catalog classification is
 *  core. Rows without a catalog entry fall back to their persisted columns —
 *  see deriveClassification in core.ts. */
export function isCatalogJobLocked(jobId: string): boolean {
  return CATALOG_BY_JOB_ID.get(jobId)?.category === "core";
}
