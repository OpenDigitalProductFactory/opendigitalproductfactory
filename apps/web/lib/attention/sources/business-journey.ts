// Business-journey source (BI-E105303D) — a critical business journey that
// failed its scheduled watchdog run, projected from the `journey_failure`
// PortfolioQualityIssue rows the watchdog maintains.
//
// Read-only projection: the row's lifecycle stays owned by the watchdog, which
// resolves it on the next passing run of the same journey. Same shape as
// `platform-health.ts` — deliberately, so the inbox has one mental model for
// "something is broken and no automation will fix it".
//
// Deep-link discipline (BI-C7D25599, 2026-07-22 live audit): the action lands on
// the SPECIFIC journey, not a list. An operator who has already paid the cost of
// being interrupted must not then have to go looking.

import type { prisma } from "@dpf/db";
import { uncheckedSentence } from "@/lib/business-journeys/depth";
import type { VerificationDepth } from "@/lib/business-journeys/types";
import type { AttentionItem } from "../types";

type Db = typeof prisma;

export type OpenJourneyFailureIssue = {
  issueKey: string;
  severity: string;
  summary: string;
  details: unknown;
  firstDetectedAt: Date;
};

type JourneyIssueDetails = {
  journeyId?: string;
  outcome?: string;
  businessImpact?: string;
  revenueBearing?: boolean;
  achievedDepth?: VerificationDepth | null;
  failedSteps?: Array<{ label?: string; detail?: string }>;
};

function detailsOf(raw: unknown): JourneyIssueDetails {
  return raw && typeof raw === "object" ? (raw as JourneyIssueDetails) : {};
}

/**
 * The honest "why now" line. Names what the business lost and the first thing
 * that failed — not the step id, not the adapter key.
 */
export function journeyWhyNow(details: JourneyIssueDetails): string {
  const impact = details.businessImpact?.trim();
  const firstFailure = details.failedSteps?.[0];
  const cause = firstFailure?.detail?.trim() || firstFailure?.label?.trim();
  const parts = [impact, cause ? `What failed: ${cause}` : null].filter(
    (p): p is string => Boolean(p),
  );
  // The unchecked-depth sentence keeps the card from implying the watchdog knows
  // more than it does.
  const unchecked = uncheckedSentence(details.achievedDepth ?? null);
  if (unchecked) parts.push(unchecked);
  return parts.join(" ");
}

/** Pure projection of one open journey-failure issue into an attention item. */
export function journeyFailureToAttentionItem(issue: OpenJourneyFailureIssue): AttentionItem {
  const details = detailsOf(issue.details);
  const journeyId = details.journeyId ?? issue.issueKey.replace(/^journey-failure:/, "");
  const deepLink = `/ops/journeys?journey=${encodeURIComponent(journeyId)}`;
  return {
    id: `business-journey:${issue.issueKey}`,
    source: "business-journey",
    // The outcome the business lost, in the owner's words.
    title: details.outcome ? `${details.outcome} — not working` : issue.summary,
    context: journeyWhyNow(details),
    // A broken journey is a fact to act on, not a scored judgement call — same
    // stance as platform-health.
    decisionClass: { scorability: "unscorable" },
    riskClass: details.revenueBearing || issue.severity === "error" ? "high-risk" : "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "no-self-heal",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: issue.firstDetectedAt.toISOString(),
    actions: [{ kind: "open-in-context", label: "See what failed", href: deepLink }],
    deepLink,
    audience: { operator: true },
  };
}

/**
 * Load open journey failures. Customer-scoped rows are excluded for the same
 * reason platform-health excludes them: they belong to the customer estate
 * queue, not the operator's own attention.
 */
export async function loadBusinessJourneyItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.portfolioQualityIssue.findMany({
    where: { issueType: "journey_failure", status: "open", customerAccountId: null },
    select: {
      issueKey: true,
      severity: true,
      summary: true,
      details: true,
      firstDetectedAt: true,
    },
    orderBy: { firstDetectedAt: "asc" },
  });
  return rows.map(journeyFailureToAttentionItem);
}
