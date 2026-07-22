// Progressive-disclosure state for the /customer/marketing overview.
//
// BI-8AB9C904: the marketing overview must open with ONE owner-first decision
// (phrased as a question in the owner's own vocabulary) and defer the strategy,
// campaign, and — especially — publish/review machinery behind disclosure until
// there is real, archetype-fit work to act on. A brand-new restaurant owner must
// not land on three empty publish queues plus a full strategy dossier.
//
// BI-CC580161: off-archetype / software-platform ("imported / test") artifacts
// must be quarantined and clearly marked unusable, never presented as active
// campaign / review / publish work. This module counts them so the page can show
// a single quarantine banner instead of scattering wrong-archetype copy through
// the live queues.
//
// Pure and framework-free so it can be unit-tested without rendering React.

import type { MarketingWorkspaceSnapshot } from "@/lib/marketing";
import type { MarketingPlaybook } from "@/lib/tak/marketing-playbooks";
import { assessArchetypeFit } from "@/lib/marketing/archetype-fit";

type CampaignBriefRow = MarketingWorkspaceSnapshot["workProducts"]["campaignBriefs"][number];

function campaignBriefText(
  brief: Pick<CampaignBriefRow, "title" | "objective" | "audience" | "notes" | "kpis">,
): string {
  return [brief.title, brief.objective, brief.audience, brief.notes, brief.kpis.join(" ")]
    .filter(Boolean)
    .join("\n");
}

export type MarketingDisclosure = {
  /** At least one saved campaign brief that actually fits the active archetype. */
  hasArchetypeFitCampaign: boolean;
  /** Drafts awaiting review + approved drafts + inbound replies. */
  reviewableCount: number;
  /**
   * Whether the publish/review queues should render at all. Deferred until there
   * is either an archetype-fit campaign or real review work — so a fresh install
   * shows a single "unlocks with your first campaign" note, not empty queues.
   */
  showPublishReview: boolean;
  /** Whether the publish/review disclosure should start expanded. */
  publishReviewOpenByDefault: boolean;
  /** Saved artifacts (briefs + drafts) blocked as imported/test / platform-leak. */
  quarantinedCount: number;
};

/**
 * Derive the progressive-disclosure state for the marketing overview from the
 * saved workspace snapshot and the active archetype category.
 */
export function buildMarketingDisclosure(
  snapshot: MarketingWorkspaceSnapshot,
): MarketingDisclosure {
  const category = snapshot.storefront.category;

  const briefFits = snapshot.workProducts.campaignBriefs.map((brief) =>
    assessArchetypeFit({ text: campaignBriefText(brief), category }),
  );
  const draftFits = [...snapshot.pendingDrafts, ...snapshot.approvedDrafts].map((draft) =>
    assessArchetypeFit({ text: draft.body, category }),
  );

  const hasArchetypeFitCampaign = briefFits.some((fit) => fit.severity === "ok");
  const reviewableCount =
    snapshot.pendingDrafts.length +
    snapshot.approvedDrafts.length +
    snapshot.inboundMessages.length;

  const quarantinedCount =
    briefFits.filter((fit) => fit.blocked).length + draftFits.filter((fit) => fit.blocked).length;

  return {
    hasArchetypeFitCampaign,
    reviewableCount,
    showPublishReview: hasArchetypeFitCampaign || reviewableCount > 0,
    publishReviewOpenByDefault:
      snapshot.pendingDrafts.length > 0 || snapshot.approvedDrafts.length > 0,
    quarantinedCount,
  };
}

// ─── Owner-first question ──────────────────────────────────────────────────
// The first screen poses one question in the owner's own language. For a
// restaurant this is booking demand, not "campaign brief #2". Jobs are grounded
// in the archetype so other categories inherit a sensible question too.

const OWNER_JOB_HINTS: Record<string, string[]> = {
  // BI-CC580161 acceptance vocabulary — food/hospitality jobs.
  "food-hospitality": [
    "fill slow nights",
    "private dining",
    "catering",
    "seasonal menus",
    "reviews",
    "repeat guests",
    "booking conversion",
  ],
};

/** Short, owner-language "jobs" for the question, grounded in the archetype. */
export function marketingOwnerJobs(
  category: string | null | undefined,
  playbook: MarketingPlaybook,
): string[] {
  const explicit = OWNER_JOB_HINTS[(category ?? "").trim().toLowerCase()];
  if (explicit) return explicit;
  // Fallback: derive concise jobs from the playbook's campaign types.
  return playbook.campaignTypes
    .slice(0, 4)
    .map((type) =>
      type
        .toLowerCase()
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .split(/ and | & |,|:|\//)[0]!
        .trim(),
    )
    .filter(Boolean);
}

/**
 * The single owner-first question for the marketing overview's first viewport.
 * Restaurants are asked about booking demand explicitly (per BI-CC580161).
 */
export function buildMarketingOwnerQuestion(
  category: string | null | undefined,
  playbook: MarketingPlaybook,
): string {
  const jobs = marketingOwnerJobs(category, playbook).slice(0, 4);
  const jobList = jobs.join(", ");
  const cat = (category ?? "").trim().toLowerCase();
  if (cat.includes("food") || cat.includes("hospitality")) {
    return jobList
      ? `What booking demand do you want to improve — ${jobList}?`
      : "What booking demand do you want to improve?";
  }
  return jobList
    ? `Where do you want to grow first — ${jobList}?`
    : "Where do you want to grow first?";
}
