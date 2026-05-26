import { prometheusPoll, fullDiscoverySweep } from "./discovery-poll";
import { modelDiscoveryRefresh } from "./model-discovery-refresh";
import { infraPrune } from "./infra-prune";
import { rateRecovery } from "./rate-recovery";
import { mcpCatalogSync } from "./mcp-catalog-sync";
import { codeGraphReconcileEvent, codeGraphReconcileScheduled } from "./code-graph-reconcile";
import { routeWorkItem } from "./route-work-item";
import { issueReportTriage } from "./issue-report-triage";
import { agentTaskDispatch } from "./agent-task-dispatch";
import { taskrunWatchdog } from "./taskrun-watchdog";
import { evalBackground, probeBackground } from "./eval-background";
import { brandExtract } from "./brand-extract";
import { buildReviewVerification } from "./build-review-verification";
import { assuranceBomGenerate } from "./assurance-bom";
import { assuranceScanRun } from "./assurance-scan";
import { deliberationRun } from "./deliberation-run";
import {
  governedBacklogTeeUpRequested,
  governedBacklogTeeUpScheduled,
} from "./governed-backlog-tee-up";
import { tokenExpiryMonitor } from "./token-expiry-monitor";
import { selfUpgradeScheduled, selfUpgradeManual } from "./self-upgrade";
import { quiescenceRun } from "./quiescence-run";
import { wikiLint } from "./wiki-lint";
import { gitPromotionSandboxVerification } from "./git-promotion-sandbox-verification";
import { skillMetricsAggregator } from "./skill-metrics-aggregator";
import { skillCurator } from "./skill-curator";
import {
  allBackupsDailyScheduled,
  postgresDailyBackupScheduled,
  postgresBackupRequested,
  postgresTrialRestoreRequested,
  neo4jBackupRequested,
  qdrantBackupRequested,
} from "./postgres-daily-backup";
import { envFlagEnabled } from "@/lib/runtime/env-flags";

export const scheduledFunctions = [
  prometheusPoll,
  fullDiscoverySweep,
  modelDiscoveryRefresh,
  infraPrune,
  codeGraphReconcileScheduled,
  issueReportTriage,
  agentTaskDispatch,
  taskrunWatchdog,
  governedBacklogTeeUpScheduled,
  tokenExpiryMonitor,
  wikiLint,
  skillMetricsAggregator,
  skillCurator,
  allBackupsDailyScheduled,
  postgresDailyBackupScheduled,
  selfUpgradeScheduled,
];

export const eventFunctions = [
  rateRecovery,
  mcpCatalogSync,
  codeGraphReconcileEvent,
  routeWorkItem,
  evalBackground,
  probeBackground,
  brandExtract,
  buildReviewVerification,
  assuranceBomGenerate,
  assuranceScanRun,
  deliberationRun,
  governedBacklogTeeUpRequested,
  gitPromotionSandboxVerification,
  postgresBackupRequested,
  postgresTrialRestoreRequested,
  neo4jBackupRequested,
  qdrantBackupRequested,
  selfUpgradeManual,
  quiescenceRun,
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
