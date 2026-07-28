// Marketing "one next decision" for the owner's first viewport.
//
// The /customer/marketing page must open with a single, archetype-scoped next
// decision — the one thing this business owner should do next, phrased in their
// own vocabulary (a restaurant owner sees covers, bookings, quiet services and
// reviews, not "campaign brief #2"). The decision is derived from the saved
// marketing state plus the active archetype playbook, so it stays correct as
// the workspace advances (drafts to review → publish → strategy gaps → first
// campaign → seasonal push).

import type { MarketingPlaybook } from "@/lib/tak/marketing-playbooks";
import type { MarketingWorkspaceSnapshot } from "@/lib/marketing";
import type { MarketingOperatingSnapshot } from "@/lib/marketing/operating-snapshot";

export type MarketingOwnerDecision = {
  id:
    | "review-drafts"
    | "publish-approved"
    | "run-first-review"
    | "create-first-campaign"
    | "choose-proof"
    | "plan-seasonal"
    | "connect-channel"
    | "produce-assets"
    | "measure-evidence"
    | "decide-outcome";
  /** Short, archetype-flavoured decision headline. */
  headline: string;
  /** One line of supporting context. */
  detail: string;
  ctaLabel: string;
  ctaHref: string;
  /** The metric this decision moves, drawn from the archetype playbook. */
  metricFocus: string;
};

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function proofNoun(playbook: MarketingPlaybook): string {
  // Restaurants feature reviews; most local businesses lean on the same idea.
  const joined = playbook.campaignTypes.join(" ").toLowerCase();
  if (joined.includes("review")) return "reviews and testimonials";
  if (joined.includes("case stud")) return "case studies";
  return "proof (reviews, testimonials, or outcomes)";
}

/**
 * Owner-language phrasing for each canonical next step.
 *
 * The canonical next step is decided ONCE, in the operating snapshot, and is
 * shared with the coworker tools; this table only re-voices it for the owner's
 * first viewport so the page and the MCP surface can never disagree about what
 * should happen next. The `href` always comes from the canonical step.
 */
const OWNER_DECISION_BY_NEXT_STEP: Record<
  MarketingOperatingSnapshot["nextStep"]["id"],
  { id: MarketingOwnerDecision["id"]; ctaLabel: string }
> = {
  "review-drafts": { id: "review-drafts", ctaLabel: "Review drafts" },
  "publish-approved": { id: "publish-approved", ctaLabel: "Go to publish queue" },
  "connect-channel": { id: "connect-channel", ctaLabel: "Connect a channel" },
  "run-strategy-review": { id: "run-first-review", ctaLabel: "Start marketing review" },
  "establish-campaign": { id: "create-first-campaign", ctaLabel: "Plan a campaign" },
  "produce-assets": { id: "produce-assets", ctaLabel: "See campaign work" },
  "measure-evidence": { id: "measure-evidence", ctaLabel: "Check results" },
  "decide-outcome": { id: "decide-outcome", ctaLabel: "Review results" },
};

/**
 * Compute the single next decision to surface in the first viewport.
 *
 * With an operating snapshot the decision is a re-voicing of the canonical next
 * step. Without one (callers that only hold the workspace snapshot) it falls
 * back to the original saved-state priority, which runs from the most
 * time-sensitive owner action (drafts waiting on them) down to steady-state
 * planning.
 */
export function buildMarketingOwnerDecision(
  snapshot: MarketingWorkspaceSnapshot,
  playbook: MarketingPlaybook,
  operating?: MarketingOperatingSnapshot,
): MarketingOwnerDecision {
  const metricFocus = playbook.keyMetrics[0] ?? "Customer acquisition";

  if (operating) {
    const step = operating.nextStep;
    const voiced = OWNER_DECISION_BY_NEXT_STEP[step.id];
    // Drafts waiting on the owner keep their archetype-specific phrasing.
    const headline =
      step.id === "review-drafts"
        ? `Review ${count(operating.approvals.pendingDrafts, "draft")} before ${audienceWord(playbook)} see them`
        : step.headline;
    return {
      id: voiced.id,
      headline,
      detail: step.detail,
      ctaLabel: voiced.ctaLabel,
      ctaHref: step.href,
      metricFocus,
    };
  }

  const firstCampaign = playbook.campaignTypes[0] ?? "your first campaign";
  const pending = snapshot.pendingDrafts.length;
  const approved = snapshot.approvedDrafts.length;
  const hasReview = Boolean(snapshot.latestReview);
  const reviewOverdue = snapshot.staleAreas.some((area) =>
    area.toLowerCase().includes("review"),
  );
  const briefCount = snapshot.workProducts.campaignBriefs.length;
  const proofCount = snapshot.strategy.proofAssets.length;

  if (pending > 0) {
    return {
      id: "review-drafts",
      headline: `Review ${count(pending, "draft")} before ${audienceWord(playbook)} see them`,
      detail:
        "The Marketing Strategist has copy waiting for your approval. Nothing goes out until you approve it.",
      ctaLabel: "Review drafts",
      ctaHref: "/customer/marketing#marketing-approval-queue",
      metricFocus,
    };
  }

  if (approved > 0) {
    return {
      id: "publish-approved",
      headline: `Publish ${count(approved, "approved post")}`,
      detail:
        "Approved copy is ready. Each publish is one explicit action — you stay in control of what goes live.",
      ctaLabel: "Go to publish queue",
      ctaHref: "/customer/marketing#marketing-publish-queue",
      metricFocus,
    };
  }

  if (!hasReview || reviewOverdue) {
    return {
      id: "run-first-review",
      headline: "Decide which quiet service to fill first",
      detail: `Run a strategy review so the plan targets ${playbook.primaryGoal.toLowerCase()}.`,
      ctaLabel: "Start marketing review",
      ctaHref: "/customer/marketing#marketing-launcher",
      metricFocus,
    };
  }

  if (briefCount === 0) {
    return {
      id: "create-first-campaign",
      headline: `Turn the plan into your first campaign: ${firstCampaign}`,
      detail:
        "You have a strategy but no campaign yet. Ask the strategist to shape the first campaign brief and asset.",
      ctaLabel: "Plan a campaign",
      ctaHref: "/customer/marketing/campaigns",
      metricFocus,
    };
  }

  if (proofCount === 0) {
    return {
      id: "choose-proof",
      headline: `Choose the ${proofNoun(playbook)} to feature`,
      detail:
        "Campaigns land harder with proof. Pick what makes the offer credible before the next push.",
      ctaLabel: "Review strategy",
      ctaHref: "/customer/marketing/strategy",
      metricFocus,
    };
  }

  return {
    id: "plan-seasonal",
    headline: `Plan the next push: ${firstCampaign}`,
    detail:
      "Strategy and proof are in place. Line up the next seasonal or quiet-period campaign with the strategist.",
    ctaLabel: "Plan a campaign",
    ctaHref: "/customer/marketing/campaigns",
    metricFocus,
  };
}

function audienceWord(playbook: MarketingPlaybook): string {
  const stakeholders = playbook.stakeholders.toLowerCase();
  if (stakeholders.includes("diner")) return "diners";
  if (stakeholders.includes("patient")) return "patients";
  if (stakeholders.includes("member")) return "members";
  if (stakeholders.includes("donor")) return "donors";
  if (stakeholders.includes("student")) return "students";
  if (stakeholders.includes("buyer")) return "buyers";
  return "customers";
}
