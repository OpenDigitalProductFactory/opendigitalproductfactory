import { prometheusPoll, fullDiscoverySweep } from "./discovery-poll";
import { modelDiscoveryRefresh } from "./model-discovery-refresh";
import { infraPrune } from "./infra-prune";
import { rateRecovery } from "./rate-recovery";
import { mcpCatalogSync } from "./mcp-catalog-sync";
// codeGraphReconcileEvent / codeGraphReconcileScheduled were imported here in
// ca4cb827 but their module (./code-graph-reconcile) plus the underlying
// lib/integrate/code-graph-refresh service were never committed — main has been
// failing typecheck since that commit. Removed the import to unblock CI; when
// the code-graph feature is ready to land (schema model + migration + service
// + queue function, all together) the import and array entries come back.
import { routeWorkItem } from "./route-work-item";
import { issueReportTriage } from "./issue-report-triage";
import { agentTaskDispatch } from "./agent-task-dispatch";
import { evalBackground, probeBackground } from "./eval-background";
import { hiveScoutIngest } from "./hive-scout-ingest";
import { brandExtract } from "./brand-extract";
import { buildReviewVerification } from "./build-review-verification";

export const allFunctions = [
  prometheusPoll,
  fullDiscoverySweep,
  modelDiscoveryRefresh,
  infraPrune,
  rateRecovery,
  mcpCatalogSync,
  routeWorkItem,
  issueReportTriage,
  agentTaskDispatch,
  evalBackground,
  probeBackground,
  hiveScoutIngest,
  brandExtract,
  buildReviewVerification,
];
