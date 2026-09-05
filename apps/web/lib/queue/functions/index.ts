import { prometheusPoll, fullDiscoverySweep } from "./discovery-poll";
import { modelDiscoveryRefresh } from "./model-discovery-refresh";
import { routingReachabilityPreflight } from "./routing-reachability-preflight";
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
import { capacityDrainScheduled } from "./capacity-drain";
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
import { businessMetricsAggregator } from "./business-metrics-aggregator";
import { skillCurator } from "./skill-curator";
import { mcpCallEfficiencyScan } from "./mcp-call-efficiency-scan";
import { a2aCollaborationHealthScan } from "./a2a-collaboration-health-scan";
import { workPatternProfileReview } from "./work-pattern-profile-review";
import {
  allBackupsDailyScheduled,
  postgresDailyBackupScheduled,
  postgresBackupRequested,
  postgresTrialRestoreRequested,
} from "./postgres-daily-backup";
import { runtimeTargetJanitor } from "./runtime-target-janitor";
import { runtimeArtifactJanitor } from "./runtime-artifact-janitor";
import { worktreeJanitor } from "./worktree-janitor";
import { sandboxBuildGc } from "./sandbox-build-gc";
import {
  dataRetentionSweepScheduled,
  dataRetentionSweepRequested,
} from "./data-retention-sweep";
import {
  regulatoryMonitorScanScheduled,
  regulatoryMonitorScanRequested,
} from "./regulatory-monitor-scan";
import {
  qualityIssueDriftSweepScheduled,
  qualityIssueDriftSweepRequested,
} from "./quality-issue-drift-sweep";
import {
  inngestRetentionSweepScheduled,
  inngestRetentionSweepRequested,
} from "./inngest-retention-sweep";
import { logSignatureScanner } from "./log-signature-scanner";
import { edgeIncidentCorrelation } from "./edge-incident-correlation";
import { remoteActionClaimTimeout } from "./remote-action-claim-timeout";
import { alertDeliveryBridge } from "./alert-delivery-bridge";
import { releaseHealthCheck } from "./release-health-check";
import { marketingSchedulerDispatch, postmarkCallbackDispatchRequested, postmarkCallbackDispatchSweep } from "./marketing-scheduler-dispatch";
import { recurringInvoiceDispatch } from "./recurring-invoice-dispatch";
import { siemCorrelationSweep } from "./siem-correlation-sweep";
import { patchAssessmentSweep } from "./patch-assessment-sweep";
import {
  catalogEnrichmentSweepScheduled,
  catalogEnrichmentSweepRequested,
} from "./catalog-enrichment-sweep";
import {
  identityInferenceFallbackScheduled,
  identityInferenceFallbackRequested,
} from "./identity-inference-fallback";
import { canonicalImprovementDigest } from "./canonical-improvement-digest";
import {
  coworkerCertificationNightly,
  coworkerCertificationRunNow,
} from "./coworker-certification";
import {
  businessJourneyWatchdogScheduled,
  businessJourneyWatchdogRunNow,
} from "./business-journey-watchdog";
import {
  obligationAssuranceWatchScheduled,
  obligationAssuranceWatchRunNow,
} from "./obligation-assurance-watch";
import {
  workroomDriveScheduled,
  workroomDriveRunNow,
} from "./workroom-drive";
import {
  embeddingCoverageReconcileScheduled,
  embeddingCoverageReconcileRunNow,
} from "./embedding-coverage-reconcile";
import { memoryConsolidationNightly } from "./memory-consolidation-nightly";
import {
  semanticMemoryReconcileScheduled,
  semanticMemoryReconcileRequested,
} from "./semantic-memory-reconcile";
import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { demandReconciliationScheduled } from "./demand-reconciliation";
import { workPatternExperimentRun } from "./work-pattern-experiment";
import { buildPrDeliveryReconcile } from "./build-pr-delivery-reconcile";
import {
  dataControlOperationRecoveryRequested,
  dataControlOperationRecoveryScheduled,
} from "./data-control-operation";
import { indexIntegritySweep } from "./index-integrity-sweep";
import { localModelInstall } from "./local-model-install";
import { nonprodCapacityAvailable, nonprodLeaseWaitReconciliation } from "./nonprod-lease-wait";
import {
  mcpTaskRunDispatchReconciliation,
  mcpTaskRunExecute,
} from "./mcp-task-run-execute";
import {
  asyncInferenceOperationOutbox,
  asyncInferenceOperationReconciliation,
  asyncInferenceOperationRun,
  asyncInferenceOperationTaskRunTransition,
} from "./async-inference-operation";
import { asyncOperationTaskHub } from "./async-operation-task-hub";

export const scheduledFunctions = [
  prometheusPoll,
  fullDiscoverySweep,
  modelDiscoveryRefresh,
  routingReachabilityPreflight, // BI-E2CCFAC1: coworker routing dead-ends surface before a human hits one
  infraPrune,
  codeGraphReconcileScheduled,
  issueReportTriage,
  backlogTriageDrain,
  coworkerRegressionDetect,
  agentTaskDispatch,
  taskrunWatchdog,
  governedBacklogTeeUpScheduled,
  capacityDrainScheduled, // use-it-or-lose-it: drain idle weekly allocation into top demand near reset
  assuranceRemediationTeeUpScheduled, // BI-7C121CCF: off-hours, budget-capped assurance remediation lane
  assuranceMergeGateScheduled, // BI-204EE70B P2.2: WWMD merge gate (dark — escalate-only until actuation enabled)
  tokenExpiryMonitor,
  contributorInventorySyncCron,
  wikiLint,
  skillMetricsAggregator,
  queueMetricsAggregator, // EP-3516E23D P1: hourly QueueTelemetryEvent → QueueMetricSnapshot rollup
  businessMetricsAggregator, // BI-PLAN-005: hourly operational sources → owner/manager BusinessMetricRollup
  skillCurator,
  mcpCallEfficiencyScan, // BI-A08EBAEC: daily ToolExecution thrash/volume/failure findings → PlatformNotification
  a2aCollaborationHealthScan, // BI-3003EE63: daily A2A edge health (failed/blocked/stuck/orphan) — slice 1 analyze+log

  workPatternProfileReview,
  researchScheduleScan,
  materialFreshnessDecay,
  allBackupsDailyScheduled,
  postgresDailyBackupScheduled,
  selfUpgradeScheduled,
  runtimeTargetJanitor,  // BI-AD949172: RT heartbeat sweep + lease expiry, hourly
  runtimeArtifactJanitor, // BI-DBF3F426/BI-A55BE432: orphaned CI images + stray compose projects (+ their volumes), daily 05:20; DPF_RUNTIME_ARTIFACT_JANITOR_ENABLED=observe, +DPF_RUNTIME_ARTIFACT_JANITOR_AUTO_REAP=live
  worktreeJanitor, // BI-42FA7DD8: host worktree Tier-A fleet backstop; daily 05:40
  sandboxBuildGc, // BI-8BD61C30: BS sandbox .builds worktree + aged build/* branch GC (flag DPF_SANDBOX_BUILD_GC_ENABLED), daily 05:50
  dataRetentionSweepScheduled, // EP-DATA-RETENTION: daily DB purge of aged logs/telemetry/chat, 04:00
  regulatoryMonitorScanScheduled, // BI-DA37A602: weekly regulatory rescan so the compliance surface self-heals instead of aging into a false green, Mon 06:00

  qualityIssueDriftSweepScheduled, // BI-0B420A1D: runtime governance — self-heal recovery/orphan backstop + detect per-type open-count drift vs registry budgets, daily 05:00

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
  catalogEnrichmentSweepScheduled, // EP-ASSET-INTELLIGENCE: weekly CatalogIdentity enrichment loop (endoflife.date + CPE + SBOM), Mon 04:37
  identityInferenceFallbackScheduled, // EP-ASSET-INTELLIGENCE: weekly cheap-model AI resolution of the unresolved-identity tail (batched, budget-capped), Tue 04:43
  remoteActionClaimTimeout,   // EP-REMOTE-ACTION P2: time out stale claimed RemoteActions so the pull queue can't wedge, every 10m (flag-gated)
  coworkerCertificationNightly, // EP-COWORKER-LIFECYCLE P2 (BI-DE9CC88B): nightly golden-journey certification of every roster coworker, 04:40
  embeddingCoverageReconcileScheduled, // BI-ED117C82: re-embeds published pages a boot hook could not reach; retries every 2h so a silent corpus gap self-heals
  businessJourneyWatchdogScheduled, // BI-E105303D / EP-PROACTIVE-OPS: exercises the install's critical business journeys against the running system, Mon/Wed/Fri 06:00
  obligationAssuranceWatchScheduled, // TAK §8.11: deadline-horizon sweep over recorded obligations, control reviews, and licence expiries, daily 05:40
  workroomDriveScheduled, // BI-FCD639D9: standing Workroom drive — wake, lease, dispatch, attention, stop, every 15m
  canonicalImprovementDigest, // BI-8996BBBB: weekly [reference-doc] proposal digest -> canonical-source chore BI
  memoryConsolidationNightly, // BI-907C4327: EP-8C706944 P2 autoDream — nightly batch-dedupe + expire coworker notes / user facts, 04:20
  semanticMemoryReconcileScheduled, // BI-DG-001: EP-DATA-GOVERNANCE — nightly orphan reconciliation of the semantic-memory derived copy, 05:10 (after retention sweep)
  demandReconciliationScheduled, // BI-44AA45BF: trusted-link demand projection, retry, and reconciliation every five minutes
  buildPrDeliveryReconcile, // BI-7C4FDBF5: exact-SHA Build Studio PR readiness, queue enrollment, and restart recovery
  dataControlOperationRecoveryScheduled, // BI-DG-014: durable cross-store data mutation recovery and reconciliation
  indexIntegritySweep, // BI-D9C20A97: daily live-database btree/collation integrity sweep
  postmarkCallbackDispatchSweep,
  nonprodLeaseWaitReconciliation,
  mcpTaskRunDispatchReconciliation,
  asyncInferenceOperationReconciliation,
  asyncInferenceOperationOutbox,
];

export const eventFunctions = [
  localModelInstall,
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
  selfUpgradeManual,
  quiescenceRun,
  dataRetentionSweepRequested, // EP-DATA-RETENTION: operator "run now" / dry-run
  regulatoryMonitorScanRequested, // BI-DA37A602: operator "run now" off-cadence regulatory rescan
  qualityIssueDriftSweepRequested, // BI-0B420A1D: operator "run now" for the quality-issue drift sweep

  inngestRetentionSweepRequested, // BI-0AB96FE7: operator "run now" / dry-run for the Inngest retention sweep
  mdmStewardSweepRequested, // EP-4A12A7CB slice 4: Data Steward "run now" / dry-run
  catalogEnrichmentSweepRequested, // EP-ASSET-INTELLIGENCE: catalog enrichment "run now" (poll-on-request)
  identityInferenceFallbackRequested, // EP-ASSET-INTELLIGENCE: AI identity-resolution fallback "run now" (poll-on-request)
  coworkerCertificationRunNow, // EP-COWORKER-LIFECYCLE P2 (BI-DE9CC88B): operator "run now" certification sweep
  embeddingCoverageReconcileRunNow, // BI-ED117C82: operator/agent "run now" embedding-coverage reconcile
  businessJourneyWatchdogRunNow, // BI-E105303D: operator "run now" business-journey watchdog sweep
  obligationAssuranceWatchRunNow, // TAK §8.11: operator "run now" obligation assurance watch
  workroomDriveRunNow, // BI-FCD639D9: operator "run now" standing Workroom drive
  semanticMemoryReconcileRequested, // BI-DG-001: operator "run now" semantic-memory orphan reconciliation
  postmarkCallbackDispatchRequested,
  workPatternExperimentRun,
  dataControlOperationRecoveryRequested,
  nonprodCapacityAvailable,
  mcpTaskRunExecute,
  asyncInferenceOperationRun,
  asyncInferenceOperationTaskRunTransition,
  asyncOperationTaskHub,
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
