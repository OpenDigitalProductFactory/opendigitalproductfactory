import { prometheusPoll, fullDiscoverySweep } from "./discovery-poll";
import { infraPrune } from "./infra-prune";
import { rateRecovery } from "./rate-recovery";
import { mcpCatalogSync } from "./mcp-catalog-sync";
import { routeWorkItem } from "./route-work-item";

export const allFunctions = [
  prometheusPoll,
  fullDiscoverySweep,
  infraPrune,
  rateRecovery,
  mcpCatalogSync,
  routeWorkItem,
];
