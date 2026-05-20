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
import { deliberationRun } from "./deliberation-run";
import {
  governedBacklogTeeUpRequested,
  governedBacklogTeeUpScheduled,
} from "./governed-backlog-tee-up";
import { tokenExpiryMonitor } from "./token-expiry-monitor";
import { wikiLint } from "./wiki-lint";
import { gitPromotionSandboxVerification } from "./git-promotion-sandbox-verification";
import { skillMetricsAggregator } from "./skill-metrics-aggregator";
import { skillCurator } from "./skill-curator";
import {
  portalSelfUpgradeCompletionSweep,
  portalSelfUpgradeRequested,
  portalSelfUpgradeScheduled,
} from "./portal-self-upgrade";
import {
  allBackupsDailyScheduled,
  postgresDailyBackupScheduled,
  postgresBackupRequested,
  neo4jBackupRequested,
  qdrantBackupRequested,
} from "./postgres-daily-backup";

export const allFunctions = [
  prometheusPoll,
  fullDiscoverySweep,
  modelDiscoveryRefresh,
  infraPrune,
  rateRecovery,
  mcpCatalogSync,
  codeGraphReconcileScheduled,
  codeGraphReconcileEvent,
  routeWorkItem,
  issueReportTriage,
  agentTaskDispatch,
  taskrunWatchdog,
  evalBackground,
  probeBackground,
  brandExtract,
  buildReviewVerification,
  deliberationRun,
  governedBacklogTeeUpScheduled,
  governedBacklogTeeUpRequested,
  tokenExpiryMonitor,
  wikiLint,
  gitPromotionSandboxVerification,
  skillMetricsAggregator,
  skillCurator,
  portalSelfUpgradeScheduled,
  portalSelfUpgradeRequested,
  portalSelfUpgradeCompletionSweep,
  allBackupsDailyScheduled,
  postgresDailyBackupScheduled,
  postgresBackupRequested,
  neo4jBackupRequested,
  qdrantBackupRequested,
];
