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
// catalog<->registry parity test (queue/functions/index.test.ts) matches each
// scheduled function's id() against these inngestIds and fails the build on any
// gap in either direction. That guard did NOT exist when logSignatureScanner /
// alertDeliveryBridge / releaseHealthCheck shipped, so they ran uncatalogued —
// invisible on the admin Scheduled Jobs surface — until this catalog was
// reconciled (scheduling-surface review, 2026-06-21). Keep the parity test real.

import { CODE_GRAPH_JOB_ID } from "@/lib/build/code-graph/constants";
import {
  EMBEDDING_COVERAGE_JOB_ID,
  EMBEDDING_COVERAGE_JOB_NAME,
  EMBEDDING_COVERAGE_INNGEST_ID,
  EMBEDDING_COVERAGE_REQUESTED_EVENT,
  EMBEDDING_COVERAGE_CRON,
  EMBEDDING_COVERAGE_CADENCE,
} from "@/lib/wiki/embedding-coverage-constants";
import {
  CATALOG_SWEEP_JOB_ID,
  CATALOG_SWEEP_JOB_NAME,
  CATALOG_SWEEP_SCHEDULED_INNGEST_ID,
  CATALOG_SWEEP_REQUESTED_EVENT,
  CATALOG_SWEEP_CRON,
  CATALOG_SWEEP_CADENCE,
} from "@/lib/asset-intelligence/catalog-sweep-constants";
import {
  IDENTITY_INFERENCE_JOB_ID,
  IDENTITY_INFERENCE_JOB_NAME,
  IDENTITY_INFERENCE_SCHEDULED_INNGEST_ID,
  IDENTITY_INFERENCE_REQUESTED_EVENT,
  IDENTITY_INFERENCE_CRON,
  IDENTITY_INFERENCE_CADENCE,
} from "@/lib/asset-intelligence/identity-inference-constants";
/** core = platform-integrity cron, operator read-only. editable = cadence
 *  may be tuned by an operator after install. */
import type { JobCategory, ScheduledJobCatalogEntry } from "./catalog-types";
import { FLOW_JOB_CATALOG_ENTRIES } from "./catalog-flow";
import { WATCH_JOB_CATALOG_ENTRIES } from "./catalog-watches";

// Re-exported so existing importers of the catalog keep working; the types are
// owned by ./catalog-types (BI-ED117C82).
export type { JobCategory, ScheduledJobCatalogEntry };

// Ordered roughly by operational prominence. core-locked jobs first.
export const SCHEDULED_JOB_CATALOG: readonly ScheduledJobCatalogEntry[] = [
  ...FLOW_JOB_CATALOG_ENTRIES,
  {
    jobId: "index-integrity-sweep",
    inngestId: "ops/index-integrity-sweep",
    name: "Live database index integrity sweep",
    purpose:
      "Checks the persistent install database for btree-to-heap disagreement and blocking collation drift, then raises one deduplicated platform issue before ghost records reach users.",
    cron: "30 5 * * *",
    cadence: "Daily at 05:30",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "build-pr-delivery-reconcile",
    inngestId: "build/pr-delivery-reconcile",
    name: "Build Studio PR delivery reconcile",
    purpose:
      "Recovers Build Studio pull requests through exact-head readiness, stale-branch updates, and the protected merge queue without bypassing governed release.",
    cron: "2,7,12,17,22,27,32,37,42,47,52,57 * * * *",
    cadence: "Every 5 minutes, offset by 2 minutes",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "data-control-operation-recovery",
    inngestId: "govern/data-control-operation-recovery-scheduled",
    name: "Data control operation recovery",
    purpose:
      "Resumes durable data-control operations after worker crashes and escalates partial outcomes.",
    cron: "4,9,14,19,24,29,34,39,44,49,54,59 * * * *",
    cadence: "Every 5 minutes, offset by 4 minutes",
    category: "core",
    tracksRunData: false,
    runNowEvent: "govern/data-control-operation.recover",
  },
  {
    jobId: CODE_GRAPH_JOB_ID, // "code-graph-reconcile"
    honorsEnabledGate: true,
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
    // Mirrors SELF_UPGRADE_CRON ("0 * * * *") in queue/functions/self-upgrade.ts.
    // The poll is hourly, but a run only proceeds inside the maintenance window
    // (whenever the storefront is closed, in the store's timezone) and no more
    // often than checkIntervalHours. The old "Nightly" label misrepresented this
    // and made a noon run read as "off-schedule" when it was the window misfiring.
    cron: "0 * * * *",
    cadence: "Hourly — applies only in the maintenance window (store closed)",
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
    cron: "10 3 * * *",
    cadence: "Daily at 03:10",
    category: "core",
    tracksRunData: true,
    runNowEvent: null,
  },
  {
    jobId: "routing-reachability-preflight",
    inngestId: "inference/routing-reachability-preflight",
    name: "Coworker routing reachability preflight",
    purpose: "Dry-runs routing per production coworker (incl. the payload-screening escalation ceiling); raises one owner-visible issue on zero eligible models so dead-ends are announced, not discovered mid-conversation.",
    cron: "37 */6 * * *",
    cadence: "Every 6 hours at :37",
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
    jobId: "federated-demand-reconciliation",
    inngestId: "federation/demand-reconciliation",
    name: "Federated demand reconciliation",
    purpose:
      "Projects approved same-organization platform demand, retries durable peer delivery, and withdraws records that leave the approved scope.",
    cron: "1,6,11,16,21,26,31,36,41,46,51,56 * * * *",
    cadence: "Every 5 minutes, offset by 1 minute",
    category: "core",
    tracksRunData: false,
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
    jobId: "runtime-artifact-janitor",
    inngestId: "ops/runtime-artifact-janitor",
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
    name: "Infrastructure prune",
    purpose: "Weekly reclamation of stale infra. Destructive — kept core-locked.",
    cron: "0 3 * * 0",
    cadence: "Weekly, Sun 03:00",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "alert-delivery-bridge",
    inngestId: "ops/alert-delivery-bridge",
    name: "Alert delivery bridge",
    purpose:
      "Delivers firing Prometheus/Loki alerts into the quality-issue inbox (the platform runs no Alertmanager). If it stops, firing alerts evaluate but never reach an operator — silent blindness. Core-locked for that reason.",
    // BI-915C40C6: every-minute was an orphan-accumulation multiplier (1440/day).
    // 5-minute poll keeps operator latency acceptable; taskrun-watchdog alone
    // stays every-minute as the deliberate liveness guard.
    cron: "*/5 * * * *",
    cadence: "Every 5 minutes",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  // ── Editable (operationally tunable) ──────────────────────────────────────
  {
    jobId: "quality-issue-drift-sweep",
    inngestId: "governance/quality-issue-drift-sweep-scheduled",
    name: "Quality-issue drift sweep",
    purpose:
      "Runtime half of quality-issue governance. Self-heals the recovery/orphan backstop (closes stale entity/relationship issues whose row is active again or gone) and detects DRIFT — any issue-type open count over its declared steady-state budget — so a newly-accumulating detector is surfaced automatically instead of found by inspection. Reports drift with owners for the auto-processing router to fund and route; does not file work itself.",
    cron: "23 5 * * *",
    cadence: "Daily at 05:23",
    category: "editable",
    tracksRunData: true,
    runNowEvent: "governance/quality-issue-drift-sweep.requested",
  },
  {
    jobId: "data-retention-sweep",
    honorsEnabledGate: true,
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
    jobId: "regulatory-monitor-scan",
    inngestId: "govern/regulatory-monitor-scan-scheduled",
    name: "Regulatory monitor scan",
    purpose:
      "Re-scans active regulations for changes so the compliance surface reflects a current posture instead of aging into a false green. Before this, a scan ran only when an operator pressed \"Run Scan Now\" and never refreshed. Editable so an operator can retune the cadence or run one off-cadence. BI-DA37A602.",
    cron: "0 6 * * 1",
    cadence: "Weekly on Monday at 06:00",
    category: "editable",
    tracksRunData: false,
    runNowEvent: "govern/regulatory-monitor-scan.requested",
  },
  {
    jobId: "inngest-retention-sweep",
    honorsEnabledGate: true,
    inngestId: "ops/inngest-retention-sweep-scheduled",
    name: "Inngest retention sweep",
    purpose:
      "Bounds the self-hosted Inngest history database (function_runs, spans, traces, …) and reaps runs orphaned when their Redis state TTL-expires. Without it the orphans accumulate unbounded until the single executor chokes and drives ZERO executions — a silent, total outage of all scheduled and autonomous dispatch (BI-0AB96FE7). Editable so an operator can disable or run-now this maintenance sweep.",
    cron: "17 */6 * * *",
    cadence: "Every 6 hours",
    category: "editable",
    tracksRunData: true,
    runNowEvent: "ops/inngest-retention.requested",
  },
  {
    jobId: "mdm-steward-sweep",
    honorsEnabledGate: true,
    inngestId: "ops/mdm-steward-sweep-scheduled",
    name: "MDM Data Steward sweep",
    purpose:
      "Runs the master-data quality sweep and lets the Data Steward coworker auto-resolve confident account duplicates (full autonomy incl. fuzzy, with audit trail + unmerge undo + per-run cap + conflicting-domain guardrail). If it stops, duplicates and stale customer records accumulate unreviewed. Editable so an operator can pause or run-now the autonomous steward.",
    cron: "50 4 * * *",
    cadence: "Daily at 04:50",
    category: "editable",
    tracksRunData: false,
    runNowEvent: "ops/mdm-steward.requested",
  },
  {
    jobId: "semantic-memory-reconcile",
    inngestId: "govern/semantic-memory-reconcile-scheduled",
    name: "Semantic memory orphan reconciliation",
    purpose:
      "BI-DG-001 (EP-DATA-GOVERNANCE): removes agent-memory vectors whose source coworker turn has been purged, so a deleted conversation cannot linger in semantic recall. If it stops, orphaned vectors accumulate and a source deletion is never fully propagated to the derived copy. Editable so an operator can pause or run-now the sweep.",
    cron: "10 5 * * *",
    cadence: "Daily at 05:10",
    category: "editable",
    tracksRunData: false,
    runNowEvent: "govern/semantic-memory-reconcile.requested",
  },
  {
    jobId: "discovery-prometheus-poll",
    inngestId: "ops/prometheus-poll",
    name: "Discovery: Prometheus poll",
    purpose: "Polls Prometheus for new monitoring targets. Cadence is tunable to taste.",
    cron: "5 * * * *",
    cadence: "Hourly (at :05)",
    category: "editable",
    tracksRunData: true,
    runNowEvent: null,
  },
  {
    jobId: "discovery-full-sweep",
    inngestId: "ops/full-discovery-sweep",
    name: "Discovery: full sweep",
    purpose: "Full infrastructure discovery sweep. Cadence is tunable.",
    cron: "10 * * * *",
    cadence: "Hourly (at :10)",
    category: "editable",
    tracksRunData: true,
    runNowEvent: null,
  },
  {
    jobId: "issue-report-triage",
    inngestId: "quality/issue-report-triage",
    name: "Quality: issue-report triage",
    purpose: "Triages inbound issue reports into the backlog. Cadence is tunable.",
    cron: "3,18,33,48 * * * *",
    cadence: "Every 15 min (at :03)",
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
    jobId: "canonical-improvement-digest",
    inngestId: "ops/canonical-improvement-digest",
    name: "Canonical improvement digest",
    purpose:
      "Batches [reference-doc] ImprovementProposal rows into one doc chore BI for human-approved canonical-source PRs (process-spine §6.5).",
    cron: "17 6 * * 1",
    cadence: "Weekly (Mon 06:17)",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "coworker-regression-detect",
    inngestId: "quality/coworker-regression-detect",
    name: "Coworker regression detect",
    purpose: "Scans for coworker quality regressions. Cadence is tunable.",
    cron: "6,21,36,51 * * * *",
    cadence: "Every 15 min (at :06)",
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
    jobId: "capacity-drain",
    inngestId: "build/capacity-drain-scheduled",
    name: "Capacity drain (use-it-or-lose-it)",
    purpose:
      "Near the weekly LLM-allocation reset, with a healthy pool and free build slots, dispatch top demand-ranked ready work so allocation is not wasted. Opt-in (capacityDrainEnabled).",
    cron: "17 * * * *",
    cadence: "Hourly at :17",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "assurance-remediation-tee-up",
    inngestId: "assurance/remediation-tee-up-scheduled",
    name: "Assurance remediation tee-up",
    purpose:
      "Off-hours, budget-capped auto-promotion of genuine high/critical assurance findings into Build Studio remediation builds. If it stops, auto-filed vulnerability BIs sit unworked.",
    cron: "41 * * * *",
    cadence: "Hourly at :41 — acts only in the 02:00–06:00 UTC off-hours window",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "assurance-merge-gate",
    inngestId: "assurance/merge-gate-scheduled",
    name: "Assurance merge gate",
    purpose:
      "Off-hours WWMD-gated merge decision for assurance remediation PRs (patch-only-auto): escalates non-auto PRs to a human. Auto-merge actuation is dark (DPF_ASSURANCE_AUTOMERGE_ENABLED, default off). If it stops, remediation PRs await manual merge.",
    cron: "47 * * * *",
    cadence: "Hourly at :47 — acts only in the 02:00–06:00 UTC off-hours window",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "material-freshness-decay",
    inngestId: "decision/material-freshness-decay",
    name: "Material freshness decay",
    purpose: "Decays stale decision materials. Cadence is tunable.",
    cron: "20 3 * * *",
    cadence: "Daily at 03:20",
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
    jobId: "mcp-call-efficiency-scan",
    inngestId: "ops/mcp-call-efficiency-scan",
    name: "MCP call efficiency scan",
    purpose:
      "BI-A08EBAEC: analyzes ToolExecution thrash, retry storms, and high-volume/failure tools; notifies, files critical BIs, and dispatches a one-shot AI Ops (platform-engineer) review so token waste is cut via skills, tool merges, or webhooks.",
    cron: "15 6 * * *",
    cadence: "Daily at 06:15",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "a2a-collaboration-health-scan",
    inngestId: "ops/a2a-collaboration-health-scan",
    name: "A2A collaboration health scan",
    purpose:
      "BI-3003EE63: analyzes coworker↔coworker edges (delegation, handoff, task lineage) for failed/blocked paths, stuck active delegations, and orphan lineage; notifies, files critical BIs (BI-A2A-EFF-*), and dispatches a one-shot AI Ops review (MCP-efficiency twin).",
    cron: "25 6 * * *",
    cadence: "Daily at 06:25",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "queue-metrics-aggregator",
    inngestId: "queue/metrics-aggregator",
    name: "Queue metrics aggregator",
    purpose:
      "Rolls up the QueueTelemetryEvent stream into per-queue QueueMetricSnapshot rows (wait/process/cycle time, throughput, first-pass yield). Without it, queue flow metrics never materialise for tiles or the coworker surface.",
    cron: "7 * * * *",
    cadence: "Hourly at :07",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "business-metrics-aggregator",
    inngestId: "business/metrics-aggregator",
    name: "Business metrics aggregator",
    purpose:
      "Builds tenant-scoped owner/manager performance snapshots from canonical operational evidence for archetypes the metrics engine covers (hospitality today). On an install with no covered storefront it refreshes nothing by design. The Performance view stays fast and preserves its last valid snapshot when a refresh fails.",
    cron: "17 * * * *",
    cadence: "Hourly at :17",
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
  {
    jobId: "work-pattern-profile-review",
    inngestId: "quality/work-pattern-profile-review",
    name: "Work pattern profile review",
    purpose:
      "Reviews coworker work-pattern telemetry and proposes capability needs. If it stops, repeated agent friction stays anecdotal instead of becoming governed improvement evidence.",
    cron: "17 7 * * *",
    cadence: "Daily at 07:17",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "log-signature-scanner",
    inngestId: "ops/log-signature-scanner",
    name: "Log signature scanner",
    purpose:
      "Scans container logs (Loki) for novel error signatures and files one issue per new signature. If it stops, novel log anomalies surface to no one. Cadence and noise threshold are tunable.",
    cron: "9,24,39,54 * * * *",
    cadence: "Every 15 min (at :09)",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "edge-incident-correlation",
    inngestId: "ops/edge-incident-correlation",
    name: "Edge incident correlation",
    purpose:
      "EP-MSP-FEDERATION A2+A3 — correlates a burst of edge alerts to the preceding change into one change-before-spike incident, then routes it to the right customer as a quality issue + ServiceTicket. Dark-launched behind DPF_EDGE_INCIDENT_CORRELATION_ENABLED. Cadence and lookback are tunable.",
    cron: "4,14,24,34,44,54 * * * *",
    cadence: "Every 10 min (at :04)",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "remote-action-claim-timeout",
    inngestId: "ops/remote-action-claim-timeout",
    name: "Remote action claim timeout",
    purpose:
      "EP-REMOTE-ACTION P2 — times out RemoteActions a node claimed but never reported a result for (claim-then-die), so the read-only dispatch queue can't wedge. Dark-launched behind DPF_REMOTE_ACTION_DISPATCH_ENABLED. Cadence and timeout window are tunable.",
    cron: "8,18,28,38,48,58 * * * *",
    cadence: "Every 10 min (at :08)",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "release-health-check",
    inngestId: "ops/release-health-check",
    name: "Release health check",
    purpose:
      "Polls the latest release's verify-gate outcome and keeps the operator notification + health card in sync. If it stops, a red release can go unnoticed. Cadence is tunable.",
    cron: "12,27,42,57 * * * *",
    cadence: "Every 15 min (at :12)",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "marketing-scheduler-dispatch",
    inngestId: "marketing/scheduler-dispatch",
    name: "Marketing scheduler",
    purpose:
      "Fires due scheduled outbound marketing actions (draft/publish/KPI pull) that an operator or autopilot policy queued. If it stops, scheduled marketing actions never run. Outbound sends still pass the kernel veto. Editable so an operator can disable it.",
    cron: "5,35 * * * *",
    cadence: "Every 30 min (at :05/:35)",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "postmark-callback-sweep",
    inngestId: "integrations/postmark-callback-sweep",
    name: "Postmark callback recovery",
    purpose:
      "Drains durable inbound-email responder receipts and terminal callback audit outbox rows missed by the low-latency event path. If it stops, callback acknowledgments remain safe but responder and audit recovery are delayed.",
    cron: "2,7,12,17,22,27,32,37,42,47,52,57 * * * *",
    cadence: "Every 5 minutes (at :02)",
    category: "core",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "recurring-invoice-dispatch",
    inngestId: "finance/recurring-invoice-dispatch",
    name: "Recurring invoice generator",
    purpose:
      "Generates invoices for active recurring schedules whose next date is due (idempotent; honours auto-send). If it stops, recurring invoices are not generated. Editable so an operator can disable it.",
    cron: "30 6 * * *",
    cadence: "Daily at 06:30",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "siem-correlation-sweep",
    inngestId: "ops/siem-correlation-sweep",
    name: "SIEM correlation sweep",
    purpose:
      "EP-SOVEREIGN-SOC P1: projects the platform's own audit telemetry into SecurityEvents, then scans the recent window against enabled DetectionRules + the active threat-intel index and emits Detections. If it stops, no new security detections are produced.",
    cron: "3,18,33,48 * * * *",
    cadence: "Every 15 minutes",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: "patch-assessment-sweep",
    inngestId: "ops/patch-assessment-sweep",
    name: "Estate patch assessment",
    purpose:
      "EP-PATCH-MANAGEMENT P0: projects discovered installed software into patch findings (OSV vulnerabilities + CISA KEV prioritization) on the Assurance Ledger, and resolves findings that became clean. If it stops, estate patch posture goes stale.",
    cron: "0 5 * * *",
    cadence: "Daily at 05:00",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  {
    jobId: CATALOG_SWEEP_JOB_ID,
    honorsEnabledGate: true,
    inngestId: CATALOG_SWEEP_SCHEDULED_INNGEST_ID,
    name: CATALOG_SWEEP_JOB_NAME,
    purpose:
      "EP-ASSET-INTELLIGENCE (spec §4.2/§4.4): iterates the CatalogIdentity spine and runs the open enrichment feeds — SBOM→identity bridge, CPE 2.3 crosswalk, and endoflife.date support-lifecycle milestones. If it stops, normalized identity + EOL/EOS posture goes stale.",
    cron: CATALOG_SWEEP_CRON,
    cadence: CATALOG_SWEEP_CADENCE,
    category: "editable",
    tracksRunData: true,
    runNowEvent: CATALOG_SWEEP_REQUESTED_EVENT,
  },
  {
    jobId: IDENTITY_INFERENCE_JOB_ID,
    honorsEnabledGate: true,
    inngestId: IDENTITY_INFERENCE_SCHEDULED_INNGEST_ID,
    name: IDENTITY_INFERENCE_JOB_NAME,
    purpose:
      "EP-ASSET-INTELLIGENCE (spec §4.2/§8): resolves the ambiguous tail of inventory items that deterministic fingerprint rules could not identify, using a cheap model (batched + per-run inference budget cap). Logs each AI resolution, promotes repeated ones to shadow fingerprint rules, and auto-applies only at high confidence. If it stops, unidentified estate items never gain a canonical identity or support-lifecycle posture.",
    cron: IDENTITY_INFERENCE_CRON,
    cadence: IDENTITY_INFERENCE_CADENCE,
    category: "editable",
    tracksRunData: true,
    runNowEvent: IDENTITY_INFERENCE_REQUESTED_EVENT,
  },
  {
    jobId: "coworker-certification",
    inngestId: "ops/coworker-certification-nightly",
    name: "Coworker certification",
    purpose:
      "EP-COWORKER-LIFECYCLE Phase 2 (BI-DE9CC88B): exercises every roster coworker's golden journeys through the real execution path (read-only tool surface) and records per-coworker pass/fail AssuranceRuns the workforce roster shows. If it stops, coworker certification goes stale and broken coworkers surface late again.",
    cron: "40 4 * * *",
    cadence: "Daily at 04:40",
    category: "editable",
    tracksRunData: false,
    runNowEvent: "ops/coworker-certification.requested",
  },
  {
    jobId: EMBEDDING_COVERAGE_JOB_ID,
    inngestId: EMBEDDING_COVERAGE_INNGEST_ID,
    name: EMBEDDING_COVERAGE_JOB_NAME,
    purpose:
      "BI-ED117C82: re-embeds published wiki/stance pages that are missing a vector, so the decision engine can still retrieve the organisation's own doctrine. A page without a vector degrades stance relevance to lexical and the gate then escalates instead of deciding \u2014 which the operator experiences as coworkers re-asking settled questions. Retries every 2h because the local model is often busy at boot; reports coverage into the corpus-health Workroom so a run is visible. If it stops, silent corpus gaps accumulate with no symptom pointing at them.",
    cron: EMBEDDING_COVERAGE_CRON,
    cadence: EMBEDDING_COVERAGE_CADENCE,
    category: "core",
    tracksRunData: false,
    runNowEvent: EMBEDDING_COVERAGE_REQUESTED_EVENT,
  },
  {
    jobId: "memory-consolidation-nightly",
    inngestId: "coworker/memory-consolidation-nightly",
    name: "Coworker memory consolidation",
    purpose:
      "EP-8C706944 Phase 2 + EP-COMPETENCE-FLYWHEEL (BI-907C4327, BI-4B0A1C1F): the sleep-time 'autoDream' pass distills completed work into coworker working notes, advances thread checkpoints, batch-collapses near-duplicate notes/facts to one canonical each, then expires entries unused past the retention window (supersession, never a hard delete). If it stops, coworker memory acquisition stalls and the memory stores accumulate near-duplicates and stale facts.",
    cron: "20 4 * * *",
    cadence: "Daily at 04:20",
    category: "editable",
    tracksRunData: false,
    runNowEvent: null,
  },
  ...WATCH_JOB_CATALOG_ENTRIES,
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
