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
    jobId: "legacy-proposal-expiry-sweep",
    inngestId: "ops/legacy-proposal-expiry-sweep",
    honorsEnabledGate: true,
    name: "Legacy proposal expiry",
    purpose:
      "Expires legacy coworker action proposals left undecided past the approval lifetime (BI-753D69A9). Status change only; nothing runs and no row is deleted.",
    cron: "17 4 * * *",
    cadence: "Daily at 04:17",
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
    jobId: "edge-node-janitor",
    inngestId: "ops/edge-node-janitor",
    honorsEnabledGate: true,
    name: "Edge-node janitor",
    purpose:
      "Retires an installer-managed Edge Node enrollment that a live one has superseded (silent a week beside a live node), so an Enrollment conflict heals itself.",
    cron: "33 * * * *",
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
    name: "Worktree janitor (Tier-A)",
    purpose:
      "The platform-owned worktree reaper. It runs here on the portal, with no AI client required; client session hooks only accelerate it. Observes when DPF_WORKTREE_JANITOR_ENABLED=1 and reaps Tier-A only above DPF_WORKTREE_JANITOR_MAX or with DPF_WORKTREE_JANITOR_AUTO_REAP=1. Every live run follows an observation and stays an observation when liveness is unreadable.",
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
  {
    jobId: "substrate-reconciler",
    inngestId: "ops/substrate-reconciler",
    honorsEnabledGate: true,
    name: "Substrate reconciler",
    purpose: "Restarts stopped required substrate (e.g. the sandbox reviewers infer through) and reports a wedged Docker VM (BI-903FB5F9).",
    cron: "4,9,14,19,24,29,34,39,44,49,54,59 * * * *",
    cadence: "Every 5 minutes (offset :04)",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
] as const;
