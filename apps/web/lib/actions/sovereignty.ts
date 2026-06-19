"use server";

import { prisma } from "@dpf/db";
import { requireViewCompliance } from "@/lib/actions/compliance-helpers";
import { getLocalOnlyInference } from "@/lib/inference/local-only";
import {
  computeInstallCadaReadiness,
  type InstallSovereigntyDeclaration,
  type InstallCadaReadiness,
} from "@dpf/db/cada-readiness";
import { type RegionProfile } from "@dpf/db/regulation-applicability";
import type { CadaAssuranceLevel } from "@dpf/db/sovereignty-assessment";

/**
 * Coworker/operator-facing CADA-readiness assessment. CADA is region-specific, so
 * this first reads the org's region footprint (BusinessContext) and gates on
 * applicability — an org with no EU operating/selling nexus is reported as out of
 * scope rather than assigned a tier. When in scope, it reads the live local-only
 * inference setting and scores the posture via the shared sovereignty primitive.
 *
 * EP-ESTATE-SOVEREIGNTY Phase 1 (BI-0471DC23). Read-only — view permission only.
 */
export async function assessCadaReadiness(
  declared: InstallSovereigntyDeclaration,
  target?: CadaAssuranceLevel,
): Promise<InstallCadaReadiness> {
  await requireViewCompliance();
  const localOnly = await getLocalOnlyInference();
  const bc = await prisma.businessContext.findFirst({
    orderBy: { createdAt: "asc" },
    select: { operatesIn: true, sellsTo: true, employsIn: true, dataResidency: true },
  });
  const regionProfile: RegionProfile | undefined = bc
    ? { operatesIn: bc.operatesIn, sellsTo: bc.sellsTo, employsIn: bc.employsIn, dataResidency: bc.dataResidency }
    : undefined;
  return computeInstallCadaReadiness(declared, localOnly, target, regionProfile);
}
