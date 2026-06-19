"use server";

import { requireViewCompliance } from "@/lib/actions/compliance-helpers";
import { getLocalOnlyInference } from "@/lib/inference/local-only";
import {
  computeInstallCadaReadiness,
  type InstallSovereigntyDeclaration,
  type InstallCadaReadiness,
} from "@dpf/db/cada-readiness";
import type { CadaAssuranceLevel } from "@dpf/db/sovereignty-assessment";

/**
 * Coworker/operator-facing CADA-readiness assessment. Reads the live local-only
 * inference setting and scores the install's posture against CADA's four
 * assurance levels via the shared `sovereignty-assessment` primitive.
 *
 * EP-ESTATE-SOVEREIGNTY Phase 1 (BI-0471DC23). Read-only — view permission only.
 */
export async function assessCadaReadiness(
  declared: InstallSovereigntyDeclaration,
  target?: CadaAssuranceLevel,
): Promise<InstallCadaReadiness> {
  await requireViewCompliance();
  const localOnly = await getLocalOnlyInference();
  return computeInstallCadaReadiness(declared, localOnly, target);
}
