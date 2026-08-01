import type { Page } from "@playwright/test";

import type {
  PagePurposeRegistry,
  RatifiedPurposeContract,
} from "../lib/ux-budget/page-purpose";
import {
  capturePurposeEvidence,
  capturePurposeOracle,
} from "../lib/ux-budget/purpose-browser-adapter";
import type { PurposeStateOracle } from "../lib/ux-budget/purpose-evaluator";
import { resolvePurposeEvaluationContext } from "../lib/ux-budget/purpose-validation-context";

export type CapturedRoutePurpose = {
  evidence: Awaited<ReturnType<typeof capturePurposeEvidence>>;
  oracle: PurposeStateOracle | null;
  context: ReturnType<typeof resolvePurposeEvaluationContext>;
};

export function selectSweepPurposeContracts(
  registry: PagePurposeRegistry,
): Map<string, RatifiedPurposeContract> {
  return new Map(
    registry.routes
      .filter(
        (contract): contract is RatifiedPurposeContract =>
          contract.status === "intent-ratified" && contract.derived.sweepEligible,
      )
      .map((contract) => [contract.routePath, contract]),
  );
}

export async function captureRoutePurpose(
  page: Page,
  contract: RatifiedPurposeContract | undefined,
  repoRoot: string,
): Promise<CapturedRoutePurpose> {
  return {
    evidence: await capturePurposeEvidence(page),
    oracle: contract ? await capturePurposeOracle(page, contract) : null,
    context: contract
      ? resolvePurposeEvaluationContext(contract, repoRoot)
      : undefined,
  };
}
