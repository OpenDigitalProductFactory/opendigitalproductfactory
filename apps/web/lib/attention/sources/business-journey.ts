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

/** The journeys surface itself — the only honest destination for a grouped
 *  could-not-check row, which has no single journey to land on. */
const JOURNEYS_LINK = "/ops/journeys";

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
  blockedJourneys?: Array<{ journeyId?: string; outcome?: string; revenueBearing?: boolean }>;
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
 * Projection of a grouped "checks could not run" row (BI-04CC2090).
 *
 * Kept separate from `journeyFailureToAttentionItem` rather than sharing it with
 * a flag, because almost every field differs in kind: this card must never say
 * an outcome is "not working", never rank as high-risk, and never imply the
 * business was measured. The two look similar and mean opposite things — one
 * reports the business, the other reports the watchdog.
 */
export function journeyUnverifiableToAttentionItem(
  issue: OpenJourneyFailureIssue,
): AttentionItem {
  const details = detailsOf(issue.details);
  const blocked = details.blockedJourneys ?? [];
  const named = blocked
    .map((j) => j.outcome?.trim())
    .filter((o): o is string => Boolean(o));
  const context = [
    issue.summary,
    named.length > 0 ? `Not checked: ${named.join("; ")}.` : null,
    "This says nothing about whether those journeys work. They were not tested.",
  ]
    .filter((p): p is string => Boolean(p))
    .join(" ");

  return {
    id: `business-journey:${issue.issueKey}`,
    source: "business-journey",
    title: "Some checks could not run",
    context,
    decisionClass: { scorability: "unscorable" },
    // Never high-risk, even when the journeys it blocks are revenue-bearing. The
    // risk of a missing setting is not the risk of a broken checkout, and
    // ranking them together is what buried the real signal.
    riskClass: "bounded-write",
    triage: {
      timeToAct: "none",
      residueReason: "no-self-heal",
      decideEffort: "review",
      irreversible: false,
    },
    createdAtIso: issue.firstDetectedAt.toISOString(),
    actions: [{ kind: "open-in-context", label: "See what could not be checked", href: JOURNEYS_LINK }],
    deepLink: JOURNEYS_LINK,
    audience: { operator: true },
  };
}

/**
 * Load open journey rows — both genuine failures and could-not-check groups.
 * Customer-scoped rows are excluded for the same reason platform-health excludes
 * them: they belong to the customer estate queue, not the operator's own
 * attention.
 */
export async function loadBusinessJourneyItems(db: Db): Promise<AttentionItem[]> {
  const rows = await db.portfolioQualityIssue.findMany({
    where: {
      issueType: { in: ["journey_failure", "journey_unverifiable"] },
      status: "open",
      customerAccountId: null,
    },
    select: {
      issueKey: true,
      issueType: true,
      severity: true,
      summary: true,
      details: true,
      firstDetectedAt: true,
    },
    orderBy: { firstDetectedAt: "asc" },
  });
  return rows.map((row) =>
    row.issueType === "journey_unverifiable"
      ? journeyUnverifiableToAttentionItem(row)
      : journeyFailureToAttentionItem(row),
  );
}
