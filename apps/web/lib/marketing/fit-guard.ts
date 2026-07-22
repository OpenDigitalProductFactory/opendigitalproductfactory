// Server-side archetype-fit guard.
//
// Client warnings can be bypassed, so the hard block on publishing off-archetype
// / software-platform content must be enforced where the state actually
// changes: at Approve and at Publish/Send. This module resolves the active
// archetype category for a draft's organization and runs the pure
// assessArchetypeFit engine against the content the operator is about to
// release.

import { prisma } from "@dpf/db";
import { assessArchetypeFit, type ArchetypeFitAssessment } from "./archetype-fit";

/** Resolve the active storefront archetype category for an organization. */
export async function resolveOrgArchetypeCategory(
  organizationId: string,
): Promise<string | null> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      storefrontConfig: {
        select: { archetype: { select: { category: true } } },
      },
    },
  });
  return organization?.storefrontConfig?.archetype?.category ?? null;
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

  const category = await resolveOrgArchetypeCategory(draft.organizationId);
  const text =
    input.contentOverride && input.contentOverride.trim().length > 0
      ? input.contentOverride
      : draft.body;
  const assessment = assessArchetypeFit({ text, category });

  if (assessment.blocked) {
    return { ok: false, error: assessment.summary, assessment };
  }
  return { ok: true, assessment };
}
