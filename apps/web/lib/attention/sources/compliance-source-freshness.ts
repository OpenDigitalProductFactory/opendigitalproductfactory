// Compliance-source freshness source (BI-68D44727) — the governed evidence
// behind AI-provider compliance advice is about to lapse, or already has.
//
// WHY THIS EXISTS. The provider-compliance registry stamps each source with when
// it was retrieved and how long that copy stays trustworthy. Past the window the
// advisory guard emits `stale-source`, grounding validation fails, and advice
// that would have said "conditional" degrades to a deterministic non-approval.
// Failing closed is right. Failing closed SILENTLY is the defect: nothing
// refreshed the corpus and nothing warned, so on a known date the compliance
// coworker quietly got less useful on every install, with no error to read. The
// operator experiences that as "the AI got worse", and they experience it
// whenever they next try to onboard a provider — which is precisely the moment
// they can least afford to debug it.
//
// This is the same shape as the sibling provider-credential source (BI-282C39D5):
// an asset that was valid, lapsed on a schedule, and had no proactive signal. The
// fix is the same too — fire BEFORE the lapse, while a human can still act.
//
// SCOPED ON PURPOSE. Only "expiring soon" and "already stale" project. A fresh
// source is not news, and an inbox that lists healthy things trains people to
// ignore it. Read-only projection over the registry — pure arithmetic, no DB, no
// network — so it costs nothing to include on every inbox load.

import {
  summarizeComplianceSourceFreshness,
  type ComplianceSourceFreshness,
} from "@/lib/routing/provider-suitability/source-freshness";
import type { AttentionItem } from "../types";

/** Renewal is a compliance review, not a scrape: someone opens the vendor's
 *  current policy page and confirms the specific claims DPF cites still hold.
 *  The copy says so plainly, because "refresh the source" reads like a button
 *  that exists, and no such button does. */
function describe(source: ComplianceSourceFreshness): { title: string; context: string } {
  const lapsed = source.daysUntilStale < 0;
  const when = lapsed
    ? `lapsed ${Math.abs(source.daysUntilStale)} day${Math.abs(source.daysUntilStale) === 1 ? "" : "s"} ago`
    : source.daysUntilStale === 0
      ? "lapses after today"
      : `lapses in ${source.daysUntilStale} days`;

  return {
    title: lapsed
      ? `Compliance evidence out of date: ${source.title}`
      : `Compliance evidence expiring: ${source.title}`,
    context: lapsed
      ? `DPF's copy of this ${source.publisher} source ${when} (retrieved ${source.retrievedAt}, trusted for ${source.maxAgeDays} days). ` +
        `AI-provider advice that cites it can no longer be substantiated, so it now answers "a human needs to review this" instead of giving a recommendation. ` +
        `To restore it, someone re-reads the source and confirms the claims DPF cites still hold, then updates the retrieval date.`
      : `DPF's copy of this ${source.publisher} source ${when} (retrieved ${source.retrievedAt}, trusted for ${source.maxAgeDays} days). ` +
        `Nothing is broken yet. When it lapses, AI-provider advice citing it stops giving recommendations and defers to a human instead. ` +
        `Renewing means re-reading the source and confirming the claims DPF cites still hold.`,
  };
}

/** Pure projection of one at-risk source into an attention item. */
export function complianceSourceToAttentionItem(source: ComplianceSourceFreshness): AttentionItem {
  const lapsed = source.daysUntilStale < 0;
  const { title, context } = describe(source);

  return {
    id: `compliance-source-freshness:${source.sourceKey}`,
    source: "compliance-source-freshness",
    title,
    context,
    // An expiry date is a fact, not a judgement call — the same reasoning that
    // makes a platform-health outage unscorable.
    decisionClass: { scorability: "unscorable" },
    riskClass: lapsed ? "high-risk" : "bounded-write",
    triage: {
      // Deadline-bearing on purpose: the whole point is that this has a date on
      // it. Once lapsed it is overdue; inside the warning window it is due-soon.
      timeToAct: lapsed ? "overdue" : "due-soon",
      residueReason: "no-self-heal",
      blastRadius: "AI provider compliance advice",
      // Re-attesting a vendor's data-handling terms is a judgement a person owns.
      decideEffort: "judgment",
      irreversible: false,
    },
    createdAtIso: new Date().toISOString(),
    actions: [
      { kind: "open-in-context", label: "Review AI provider compliance", href: "/platform/ai/providers" },
    ],
    deepLink: "/platform/ai/providers",
    audience: { operator: true },
  };
}

/** Project every source that is lapsed or inside the warning window.
 *
 *  `now` is injectable purely so tests need not touch the real clock — a module
 *  about expiry dates must never depend on today's date to pass. */
export function loadComplianceSourceFreshnessItems(
  options: { now?: Date } = {},
): AttentionItem[] {
  const summary = summarizeComplianceSourceFreshness({ now: options.now });
  return [...summary.stale, ...summary.expiringSoon].map(complianceSourceToAttentionItem);
}
