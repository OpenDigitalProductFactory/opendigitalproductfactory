import {
  purposeContractSourceSchema,
  type PurposeContractSource,
} from "../page-purpose";

export type PurposeContractModule = readonly PurposeContractSource[];

import { GRAPH_EXPLORER_PURPOSE_CONTRACTS } from "./graph-explorer";

const CONTRACT_MODULES: readonly PurposeContractModule[] = [
  GRAPH_EXPLORER_PURPOSE_CONTRACTS,
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
