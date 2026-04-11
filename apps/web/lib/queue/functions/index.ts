import { prometheusPoll, fullDiscoverySweep } from "./discovery-poll";
import { modelDiscoveryRefresh } from "./model-discovery-refresh";
import { infraPrune } from "./infra-prune";
import { rateRecovery } from "./rate-recovery";
import { mcpCatalogSync } from "./mcp-catalog-sync";
import { routeWorkItem } from "./route-work-item";
import { issueReportTriage } from "./issue-report-triage";

export const allFunctions = [
  prometheusPoll,
  fullDiscoverySweep,
  modelDiscoveryRefresh,
  infraPrune,
  rateRecovery,
  mcpCatalogSync,
  routeWorkItem,
  issueReportTriage,
];
