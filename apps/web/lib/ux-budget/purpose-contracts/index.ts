import {
  purposeContractSourceSchema,
  type PurposeContractSource,
} from "../page-purpose";

export type PurposeContractModule = readonly PurposeContractSource[];

import { ARCHETYPE_READINESS_PURPOSE_CONTRACTS } from "./archetype-readiness";
import { GRAPH_EXPLORER_PURPOSE_CONTRACTS } from "./graph-explorer";
import { RIGHT_NOW_PURPOSE_CONTRACTS } from "./right-now";
import { MILEAGE_PURPOSE_CONTRACTS } from "./mileage";
import { RECRUITING_PIPELINE_PURPOSE_CONTRACTS } from "./recruiting-pipeline";
import { COWORKER_IDENTITY_PURPOSE_CONTRACTS } from "./coworker-identity";
import { GOVERNED_TEARDOWN_PURPOSE_CONTRACTS } from "./governed-teardown";
import { WORDPRESS_PURPOSE_CONTRACTS } from "./wordpress";
import { WORKROOM_PURPOSE_CONTRACTS } from "./workrooms";
import { INSTALLATION_IDENTITY_PURPOSE_CONTRACTS } from "./installation-identity";
import { ADOPTION_WAITING_LIST_PURPOSE_CONTRACTS } from "./adoption-waiting-list";

const CONTRACT_MODULES: readonly PurposeContractModule[] = [
  ARCHETYPE_READINESS_PURPOSE_CONTRACTS,
  GRAPH_EXPLORER_PURPOSE_CONTRACTS,
  RIGHT_NOW_PURPOSE_CONTRACTS,
  MILEAGE_PURPOSE_CONTRACTS,
  RECRUITING_PIPELINE_PURPOSE_CONTRACTS,
  COWORKER_IDENTITY_PURPOSE_CONTRACTS,
  GOVERNED_TEARDOWN_PURPOSE_CONTRACTS,
  WORDPRESS_PURPOSE_CONTRACTS,
  WORKROOM_PURPOSE_CONTRACTS,
  INSTALLATION_IDENTITY_PURPOSE_CONTRACTS,
  ADOPTION_WAITING_LIST_PURPOSE_CONTRACTS,
];

export function buildPurposeContractSourceIndex(
  modules: readonly PurposeContractModule[] = CONTRACT_MODULES,
): Readonly<Record<string, PurposeContractSource>> {
  const contracts: Record<string, PurposeContractSource> = {};

  for (const moduleContracts of modules) {
    for (const candidate of moduleContracts) {
      const contract = purposeContractSourceSchema.parse(candidate);
      if (contracts[contract.routePath]) {
        throw new Error(
          `[page-purpose] Duplicate contract source for ${contract.routePath}.`,
        );
      }
      contracts[contract.routePath] = contract;
    }
  }

  return contracts;
}

export const PURPOSE_CONTRACT_SOURCES =
  buildPurposeContractSourceIndex();
