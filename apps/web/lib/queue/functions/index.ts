import { prometheusPoll, fullDiscoverySweep } from "./discovery-poll";
import { modelDiscoveryRefresh } from "./model-discovery-refresh";
import { infraPrune } from "./infra-prune";
import { rateRecovery } from "./rate-recovery";
import { mcpCatalogSync } from "./mcp-catalog-sync";
import { codeGraphReconcileEvent, codeGraphReconcileScheduled } from "./code-graph-reconcile";
import { routeWorkItem } from "./route-work-item";
import { issueReportTriage } from "./issue-report-triage";
import { agentTaskDispatch } from "./agent-task-dispatch";
import { evalBackground, probeBackground } from "./eval-background";
import { hiveScoutIngest } from "./hive-scout-ingest";
import { brandExtract } from "./brand-extract";
import { buildReviewVerification } from "./build-review-verification";
import { deliberationRun } from "./deliberation-run";
import {
  governedBacklogTeeUpRequested,
  governedBacklogTeeUpScheduled,
} from "./governed-backlog-tee-up";
import { tokenExpiryMonitor } from "./token-expiry-monitor";

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
  evalBackground,
  probeBackground,
  hiveScoutIngest,
  brandExtract,
  buildReviewVerification,
  deliberationRun,
  governedBacklogTeeUpScheduled,
  governedBacklogTeeUpRequested,
  tokenExpiryMonitor,
];
