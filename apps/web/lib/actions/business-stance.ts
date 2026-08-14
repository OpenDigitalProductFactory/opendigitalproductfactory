"use server";
// EP-0AF96937 Phase 3: server action for authoring a WWWD business stance.
//
// A business "adjusts WWWD" by recording how it decides something. That stance
// is stored as an org-overlay `stance` WikiPage (organizationId set), which is
// exactly the corpus the coworker decision-routing block grounds business
// ("what would WE do") calls in. Draft by default — nothing becomes active
// doctrine until it is explicitly published (safe: authoring never auto-grants
// authority).

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";
import { saveWikiOverlayEdit } from "@/lib/actions/wiki-edit";
import { promoteStanceMaterial } from "@/lib/decision-perspective/stance-promotion";
import {
  projectDeclaredStanceAlignment,
  type StanceAlignmentDimension,
} from "@/lib/decision-perspective/stance-dimension-map";
import { storeWikiPage } from "@/lib/wiki/embeddings";
import {
  decisionAreaToDomainClass,
  validateBusinessStance,
  type BusinessStanceInput,
} from "@/lib/wiki/business-stance";

export type SaveBusinessStanceResult =
  | { ok: true; slug: string; status: string }
  | { ok: false; error: string };

/**
 * Record (or update) a WWWD business stance as a draft org-overlay page.
 * Delegates the write to `saveWikiOverlayEdit`, which enforces the org scope,
 * refuses kernel writes, and appends a revision.
 */
export async function saveBusinessStance(
  input: BusinessStanceInput,
): Promise<SaveBusinessStanceResult> {
  const validated = validateBusinessStance(input);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }

  const result = await saveWikiOverlayEdit({
    slug: validated.slug,
    pageKind: "stance",
    title: validated.title,
    body: validated.body,
    status: "draft",
    abstract: validated.summary,
    changeSummary: "Business stance authored via the WWWD editor",
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  revalidatePath("/coworker-decisions/stance");
  revalidatePath("/coworker-decisions");
  return { ok: true, slug: result.slug, status: result.status };
}

export type PublishBusinessStanceResult =
  | { ok: true; slug: string; gateLive: boolean }
  | { ok: false; error: string };

/**
 * Publish a WWWD business stance and make it GATE-LIVE (BI-002DEB85).
 *
 * Until this existed, an authored stance stayed a draft page forever — a
 * policy document no decision path enforced. Publishing (a) publishes the
 * org-overlay page, (b) embeds it so coworkers retrieve it as WWWD context,
 * and (c) promotes an owner-confirmed (A/0.9) PerspectiveMaterial in the
 * decision area the owner picked, which is what actually changes what
 * evaluate_org_business_decision allows.
 */
export async function publishBusinessStance(
  input: BusinessStanceInput & { decisionArea: string },
): Promise<PublishBusinessStanceResult> {
  const validated = validateBusinessStance(input);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }
  const domainClass = decisionAreaToDomainClass(input.decisionArea);
  if (!domainClass) {
    return { ok: false, error: "Pick the kind of decisions this stance guides." };
  }
  const alignmentByDecisionArea: Record<string, readonly StanceAlignmentDimension[]> = {
    "customers-and-money": ["market_fit", "gtm_fit"],
    "priorities-and-planning": ["mission_fit", "market_fit", "product_fit", "gtm_fit"],
    "quality-and-craft": ["product_fit"],
    "vendors-and-tools": ["product_fit", "gtm_fit"],
  };
  const projection = projectDeclaredStanceAlignment(
    alignmentByDecisionArea[input.decisionArea] ?? [],
  );

  const result = await saveWikiOverlayEdit({
    slug: validated.slug,
    pageKind: "stance",
    title: validated.title,
    body: validated.body,
    status: "published",
    abstract: validated.summary,
    changeSummary: "Business stance published via the WWWD editor",
    ...projection,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    return { ok: false, error: "No organization is configured for this install." };
  }

  // Deliberation layer (best-effort): the gate-live material below is the
  // enforcement; a failed embed only weakens retrieval context.
  try {
    await storeWikiPage({
      pageId: result.pageId,
      slug: validated.slug,
      title: validated.title,
      body: validated.body,
      abstract: validated.summary,
      pageKind: "stance",
      status: "published",
      isKernel: false,
      kernelVersion: null,
      organizationId: org.id,
      kernelPageId: null,
      ...projection,
    });
  } catch {
    // best-effort; enforcement continues below
  }

  const promoted = await promoteStanceMaterial({
    db: prisma,
    organizationId: org.id,
    wikiPageId: result.pageId,
    slug: validated.slug,
    summary: validated.summary ?? validated.title,
    domainClasses: [domainClass],
    tier: "confirmed",
  });

  revalidatePath("/coworker-decisions/stance");
  revalidatePath("/coworker-decisions");
  return { ok: true, slug: result.slug, gateLive: promoted.ok };
}
