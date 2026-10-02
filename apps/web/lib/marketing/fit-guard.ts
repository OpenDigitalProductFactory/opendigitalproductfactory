// Server-side archetype-fit guard.
//
// Client warnings can be bypassed, so the hard block on publishing off-archetype
// / software-platform content must be enforced where the state actually
// changes: at Approve and at Publish/Send. This module resolves the active
// archetype category for a draft's organization and runs the pure
// assessArchetypeFit engine against the content the operator is about to
// release.

import { prisma } from "@dpf/db";
import {
  OWN_OFFER_ITEMS_QUERY,
  assessArchetypeFit,
  ownOfferFromRecords,
  type ArchetypeFitAssessment,
} from "./archetype-fit";

export type OrgMarketingFitContext = {
  category: string | null;
  /** What the organization itself sells (buildOwnOfferText); null when unstated. */
  ownOffer: string | null;
};

/**
 * Everything the fit check needs for an organization: its archetype category
 * and its own offer text. The server guard and publish read the same records
 * the marketing snapshot does, so a badge and a block never disagree.
 */
export async function resolveOrgMarketingFitContext(
  organizationId: string,
): Promise<OrgMarketingFitContext> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      businessContext: { select: { valueProposition: true } },
      storefrontConfig: {
        select: {
          tagline: true,
          description: true,
          archetype: { select: { category: true } },
          items: OWN_OFFER_ITEMS_QUERY,
        },
      },
    },
  });
  return {
    category: organization?.storefrontConfig?.archetype?.category ?? null,
    ownOffer: ownOfferFromRecords(organization?.storefrontConfig, organization?.businessContext),
  };
}

export type DraftFitGuardResult =
  | { ok: true; assessment: ArchetypeFitAssessment }
  | { ok: false; error: string; assessment: ArchetypeFitAssessment };

/**
 * Assess the fit of the content that is about to be released for a draft.
 * `contentOverride` lets Approve check the operator's edited body (they may
 * have fixed the leak) rather than the stored body.
 */
export async function guardDraftArchetypeFit(input: {
  draftId: string;
  contentOverride?: string | null;
}): Promise<DraftFitGuardResult | null> {
  const draft = await prisma.outboundDraft.findUnique({
    where: { draftId: input.draftId },
    select: { body: true, organizationId: true },
  });
  if (!draft) return null;

  const { category, ownOffer } = await resolveOrgMarketingFitContext(draft.organizationId);
  const text =
    input.contentOverride && input.contentOverride.trim().length > 0
      ? input.contentOverride
      : draft.body;
  const assessment = assessArchetypeFit({ text, category, ownOffer });

  if (assessment.blocked) {
    return { ok: false, error: assessment.summary, assessment };
  }
  return { ok: true, assessment };
}
