import { prometheusPoll, fullDiscoverySweep } from "./discovery-poll";
import { modelDiscoveryRefresh } from "./model-discovery-refresh";
import { infraPrune } from "./infra-prune";
import { rateRecovery } from "./rate-recovery";
import { mcpCatalogSync } from "./mcp-catalog-sync";
import { codeGraphReconcileEvent, codeGraphReconcileScheduled } from "./code-graph-reconcile";
import { routeWorkItem } from "./route-work-item";
import { issueReportTriage } from "./issue-report-triage";
import { issueReportProjectOnCreate } from "./issue-report-project";
import { backlogTriageDrain } from "./backlog-triage-drain";
import { coworkerRegressionDetect } from "./coworker-regression-detect";
import { agentTaskDispatch } from "./agent-task-dispatch";
import { taskrunWatchdog } from "./taskrun-watchdog";
import { evalBackground, probeBackground } from "./eval-background";
import { brandExtract } from "./brand-extract";
import { materialFreshnessDecay } from "./material-freshness-decay";
import { researchExecute } from "./research-execute";
import { researchScheduleScan } from "./research-schedule";
import { buildReviewVerification } from "./build-review-verification";
import { buildExecute } from "./build-execute";
import { preBuildReviewRepair } from "./pre-build-review-repair";
import { assuranceBomGenerate } from "./assurance-bom";
import { assuranceScanRun } from "./assurance-scan";
import { deliberationRun } from "./deliberation-run";
import {
  governedBacklogTeeUpRequested,
  governedBacklogTeeUpScheduled,
} from "./governed-backlog-tee-up";
import { assuranceRemediationTeeUpScheduled } from "./assurance-remediation-teeup";
import { assuranceMergeGateScheduled } from "./assurance-merge-gate-teeup";
import { tokenExpiryMonitor } from "./token-expiry-monitor";
import {
  contributorInventorySyncCron,
  contributorInventorySyncOnDemand,
} from "./contributor-inventory-sync";
import { selfUpgradeScheduled, selfUpgradeManual } from "./self-upgrade";
import { mdmStewardSweepScheduled, mdmStewardSweepRequested } from "./mdm-steward-sweep";
import { quiescenceRun } from "./quiescence-run";
import { wikiLint } from "./wiki-lint";
import { gitPromotionSandboxVerification } from "./git-promotion-sandbox-verification";
import { skillMetricsAggregator } from "./skill-metrics-aggregator";
import { queueMetricsAggregator } from "./queue-metrics-aggregator";
import { skillCurator } from "./skill-curator";
import { workPatternProfileReview } from "./work-pattern-profile-review";
import {
  allBackupsDailyScheduled,
  postgresDailyBackupScheduled,
  postgresBackupRequested,
  postgresTrialRestoreRequested,
  neo4jBackupRequested,
  qdrantBackupRequested,
} from "./postgres-daily-backup";
import { runtimeTargetJanitor } from "./runtime-target-janitor";
import {
  dataRetentionSweepScheduled,
  dataRetentionSweepRequested,
} from "./data-retention-sweep";
import {
  inngestRetentionSweepScheduled,
  inngestRetentionSweepRequested,
} from "./inngest-retention-sweep";
import { logSignatureScanner } from "./log-signature-scanner";
import { edgeIncidentCorrelation } from "./edge-incident-correlation";
import { remoteActionClaimTimeout } from "./remote-action-claim-timeout";
import { alertDeliveryBridge } from "./alert-delivery-bridge";
import { releaseHealthCheck } from "./release-health-check";
import { marketingSchedulerDispatch } from "./marketing-scheduler-dispatch";
import { recurringInvoiceDispatch } from "./recurring-invoice-dispatch";
import { siemCorrelationSweep } from "./siem-correlation-sweep";
import { patchAssessmentSweep } from "./patch-assessment-sweep";
import {
  coworkerCertificationNightly,
  coworkerCertificationRunNow,
} from "./coworker-certification";
import { envFlagEnabled } from "@/lib/runtime/env-flags";

export const scheduledFunctions = [
  prometheusPoll,
  fullDiscoverySweep,
  modelDiscoveryRefresh,
  infraPrune,
  codeGraphReconcileScheduled,
  issueReportTriage,
  backlogTriageDrain,
  coworkerRegressionDetect,
  agentTaskDispatch,
  taskrunWatchdog,
  governedBacklogTeeUpScheduled,
  assuranceRemediationTeeUpScheduled, // BI-7C121CCF: off-hours, budget-capped assurance remediation lane
  assuranceMergeGateScheduled, // BI-204EE70B P2.2: WWMD merge gate (dark — escalate-only until actuation enabled)
  tokenExpiryMonitor,
  contributorInventorySyncCron,
  wikiLint,
  skillMetricsAggregator,
  queueMetricsAggregator, // EP-3516E23D P1: hourly QueueTelemetryEvent → QueueMetricSnapshot rollup
  skillCurator,
  workPatternProfileReview,
  researchScheduleScan,
  materialFreshnessDecay,
  allBackupsDailyScheduled,
  postgresDailyBackupScheduled,
  selfUpgradeScheduled,
  runtimeTargetJanitor,  // BI-AD949172: RT heartbeat sweep + lease expiry, hourly
  dataRetentionSweepScheduled, // EP-DATA-RETENTION: daily DB purge of aged logs/telemetry/chat, 04:00
  inngestRetentionSweepScheduled, // BI-0AB96FE7: bound db=inngest history + reap Redis-TTL orphans that wedge the executor, every 6h
  mdmStewardSweepScheduled, // EP-4A12A7CB slice 4: autonomous Data Steward — sweep + auto-resolve account dupes, daily 05:00
  logSignatureScanner,   // BI-5FE8656F: EP-FULL-OBS Tier 2 novel-signature log scan, every 15m
  edgeIncidentCorrelation, // EP-MSP-FEDERATION A2+A3: correlate edge alerts->incidents->customer tickets, every 10m (flag-gated)
  alertDeliveryBridge,   // BI-5FE8656F: EP-FULL-OBS Tier 2 item #6 — Prometheus+Loki firing alerts -> PortfolioQualityIssue, every 1m
  releaseHealthCheck,    // BI-3630773C: EP-FULL-OBS release stamp verify-gate watch, every 15m
  marketingSchedulerDispatch, // BI-SCHED-DORMANT: wire ScheduledOutboundAction dispatch, every 30m
  recurringInvoiceDispatch,   // BI-SCHED-DORMANT: wire recurring-invoice generation, daily 06:30
  siemCorrelationSweep,       // BI-6D9496F1: EP-SOVEREIGN-SOC P1 — project internal audit -> SecurityEvent + run detection rules, every 15m
  patchAssessmentSweep,       // EP-PATCH-MANAGEMENT P0: daily estate patch posture sweep (OSV+KEV -> AssuranceFinding), 05:00
  remoteActionClaimTimeout,   // EP-REMOTE-ACTION P2: time out stale claimed RemoteActions so the pull queue can't wedge, every 10m (flag-gated)
  coworkerCertificationNightly, // EP-COWORKER-LIFECYCLE P2 (BI-DE9CC88B): nightly golden-journey certification of every roster coworker, 04:40
];

export const eventFunctions = [
  rateRecovery,
  mcpCatalogSync,
  codeGraphReconcileEvent,
  routeWorkItem,
  evalBackground,
  probeBackground,
  brandExtract,
  researchExecute,
  buildReviewVerification,
  buildExecute,
  preBuildReviewRepair,
  assuranceBomGenerate,
  assuranceScanRun,
  deliberationRun,
  governedBacklogTeeUpRequested,
  issueReportProjectOnCreate,
  contributorInventorySyncOnDemand,
  gitPromotionSandboxVerification,
  postgresBackupRequested,
  postgresTrialRestoreRequested,
  neo4jBackupRequested,
  qdrantBackupRequested,
  selfUpgradeManual,
  quiescenceRun,
  dataRetentionSweepRequested, // EP-DATA-RETENTION: operator "run now" / dry-run
  inngestRetentionSweepRequested, // BI-0AB96FE7: operator "run now" / dry-run for the Inngest retention sweep
  mdmStewardSweepRequested, // EP-4A12A7CB slice 4: Data Steward "run now" / dry-run
  coworkerCertificationRunNow, // EP-COWORKER-LIFECYCLE P2 (BI-DE9CC88B): operator "run now" certification sweep
];

export const allFunctions = [...scheduledFunctions, ...eventFunctions];

export function areScheduledInngestFunctionsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envFlagEnabled(env, "DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED");
}

export function getInngestFunctionsForRuntime(
  env: Record<string, string | undefined> = process.env,
) {
  return areScheduledInngestFunctionsEnabled(env)
    ? allFunctions
    : eventFunctions;
}
