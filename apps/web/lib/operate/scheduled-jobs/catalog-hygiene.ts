// apps/web/lib/operate/scheduled-jobs/catalog-hygiene.ts
//
// Catalog entries for the platform LIVENESS and HOST-HYGIENE crons: the
// watchdog that keeps stuck work from wedging the runtime, token-expiry
// monitoring, and the janitors that reclaim runtime targets, Docker
// artifacts, worktrees, sandbox builds and infra leftovers. They share a
// shape — core-locked, maintenance effect on the host itself — and most of
// them are deliberately outside the ScheduledJob.enabled kill switch
// (see each entry's ungatedReason, BI-7E49FA15).
//
// Split out of catalog.ts, which crossed the 800-LOC module ceiling when
// every entry gained its kill-switch posture. Same precedent as
// ./catalog-watches and ./catalog-flow.

import type { ScheduledJobCatalogEntry } from "./catalog-types";

export const HYGIENE_JOB_CATALOG_ENTRIES: readonly ScheduledJobCatalogEntry[] = [
  {
    jobId: "taskrun-watchdog",
    inngestId: "ops/taskrun-watchdog",
    ungatedReason:
      "Liveness guard: must keep running through every drain to detect stuck coordinators, so it is exempt from gateAtEntry entirely.",
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
    honorsEnabledGate: true,
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
    ungatedReason:
      "Module does not call gateAtEntry yet — not wired to the kill switch (BI-7E49FA15).",
    name: "Runtime-target janitor",
    purpose: "Sweeps stale runtime targets + expires leases. Resource hygiene.",
    cron: "0 * * * *",
    cadence: "Hourly",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "runtime-artifact-janitor",
    inngestId: "ops/runtime-artifact-janitor",
    ungatedReason:
      "Module does not call gateAtEntry yet — not wired to the kill switch (BI-7E49FA15).",
    name: "Runtime-artifact janitor",
    purpose:
      "Reaps orphaned CI build images + stray compose projects (and their named volumes). Default OFF; ENABLED alone = observe-only (logs would-reap); ENABLED + DPF_RUNTIME_ARTIFACT_JANITOR_AUTO_REAP=1 = live reap. CLI guards keep root dpf, running, and live-worktree stacks safe.",
    cron: "20 5 * * *",
    cadence: "Daily at 05:20",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "worktree-janitor",
    inngestId: "ops/worktree-janitor",
    ungatedReason:
      "Module does not call gateAtEntry yet — not wired to the kill switch (BI-7E49FA15).",
    name: "Worktree janitor fleet backstop (Tier-A)",
    purpose:
      "OPTIONAL fleet sweeper for leftover worktrees. Primary reaping is session-lifecycle (worktree-session-hygiene on SessionEnd). This portal Inngest job dry-runs when DPF_WORKTREE_JANITOR_ENABLED=1; live Tier-A only with DPF_WORKTREE_JANITOR_AUTO_REAP=1. Not a per-client CLI cron.",
    cron: "40 5 * * *",
    cadence: "Daily at 05:40",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "sandbox-build-gc",
    inngestId: "ops/sandbox-build-gc",
    ungatedReason:
      "Module does not call gateAtEntry yet — not wired to the kill switch (BI-7E49FA15).",
    name: "Build Studio sandbox build GC",
    purpose:
      "Backstop: removes leftover /workspace/.builds/<FB-*> for terminal or missing FeatureBuilds; optional aged build/* branch delete when DPF_SANDBOX_BUILD_GC_DELETE_BRANCHES=1. Primary cleanup is transactional on promote/abandon/complete. Enable with DPF_SANDBOX_BUILD_GC_ENABLED=1.",
    cron: "50 5 * * *",
    cadence: "Daily at 05:50",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "infra-prune",
    inngestId: "ops/infra-prune",
    honorsEnabledGate: true,
    name: "Infrastructure prune",
    purpose: "Weekly reclamation of stale infra. Destructive — kept core-locked.",
    cron: "0 3 * * 0",
    cadence: "Weekly, Sun 03:00",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
] as const;
