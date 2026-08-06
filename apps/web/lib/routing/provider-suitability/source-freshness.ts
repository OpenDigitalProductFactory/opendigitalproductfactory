// Compliance-source freshness horizon (BI-68D44727).
//
// WHY THIS EXISTS. Every governed source in the provider-compliance registry
// carries a `retrievedAt` stamp and its own `maxAgeDays`. Past that window
// provider-compliance-advisory.ts emits `stale-source:<ref>`, grounding
// validation fails, and an advisory that would have said "conditional" degrades
// to the deterministic non-approval instead. That direction is correct — DPF must
// not vouch for a vendor's data-handling terms from a stale copy.
//
// What was missing is the other half. Nothing refreshed the corpus and nothing
// warned before the cliff, so the degradation was silent, product-wide, and
// dated: the three provider-terms sources were retrieved 2026-07-20 with a
// 60-day window, making 2026-09-18 the day the compliance coworker quietly got
// less useful on every install. To an operator that reads as "the AI got worse",
// not "an evidence copy expired" — and it lands whenever someone happens to be
// onboarding a provider, which is exactly when they can least afford it.
//
// This module is the arithmetic behind the warning. It is deliberately PURE and
// registry-only — no database, no network — so the attention projector, a
// health surface, or a scheduled audit can all ask the same question cheaply and
// get the same answer.
//
// DELIBERATELY NOT A REQUIRED CI CHECK. A per-PR gate that fails once a source
// lapses would be a fleet-blocking time bomb with a known detonation date — the
// precise failure this warning exists to prevent (see #3883/#3885, and the
// 2026-08-01T15:00Z outage). Warn early, in-product, where a human can act; do
// not wire expiry into anything that can block a merge.

import {
  PROVIDER_COMPLIANCE_SOURCE_REGISTRY,
  type ProviderComplianceSourceEntry,
} from "@dpf/db/provider-compliance-source-registry";

const MS_PER_DAY = 86_400_000;

/** How much notice the warning gives before a source lapses.
 *
 *  Renewal is a person re-reading the vendor's current policy page and
 *  confirming the specific claims DPF cites still hold — a compliance review,
 *  not a scrape. Three weeks is enough to schedule that around other work
 *  without the alert becoming background noise it outlives. */
export const COMPLIANCE_SOURCE_EXPIRY_WARNING_DAYS = 21;

export type ComplianceSourceFreshnessStatus = "fresh" | "expiring-soon" | "stale";

export type ComplianceSourceFreshness = {
  sourceKey: string;
  title: string;
  publisher: string;
  url: string;
  sourceType: ProviderComplianceSourceEntry["sourceType"];
  retrievedAt: string;
  maxAgeDays: number;
  /** ISO date (YYYY-MM-DD) the copy stops being trusted. */
  staleFrom: string;
  /** Whole days remaining. 0 = final valid day; negative = already lapsed. */
  daysUntilStale: number;
  status: ComplianceSourceFreshnessStatus;
};

export type ComplianceSourceFreshnessSummary = {
  sources: ComplianceSourceFreshness[];
  expiringSoon: ComplianceSourceFreshness[];
  stale: ComplianceSourceFreshness[];
  /** The worst status present — what a single badge should show. */
  worst: ComplianceSourceFreshnessStatus;
};

/** Whole days from `now` until the source's window closes.
 *
 *  `maxAgeDays` is a whole-day allowance, so a source stays valid THROUGH its
 *  final day: the advisory guard rejects only when `ageDays > maxAgeDays`. Both
 *  sides are floored to UTC midnight so the answer does not swing with the time
 *  of day a page happens to be rendered. */
function daysUntilStale(source: ProviderComplianceSourceEntry, now: Date): number {
  const retrievedAtUtcMidnight = Date.parse(`${source.retrievedAt.slice(0, 10)}T00:00:00.000Z`);
  const staleFromMs = retrievedAtUtcMidnight + (source.maxAgeDays + 1) * MS_PER_DAY;
  const nowUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((staleFromMs - nowUtcMidnight) / MS_PER_DAY) - 1;
}

function classify(remaining: number): ComplianceSourceFreshnessStatus {
  if (remaining < 0) return "stale";
  if (remaining <= COMPLIANCE_SOURCE_EXPIRY_WARNING_DAYS) return "expiring-soon";
  return "fresh";
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Freshness of every governed compliance source, worst first.
 *
 *  `now` is injectable so callers can project a future horizon ("what lapses
 *  before the end of the quarter?") and so tests never depend on the real clock. */
export function summarizeComplianceSourceFreshness(
  options: { now?: Date } = {},
): ComplianceSourceFreshnessSummary {
  const now = options.now ?? new Date();

  const sources = Object.values(PROVIDER_COMPLIANCE_SOURCE_REGISTRY)
    .map((entry): ComplianceSourceFreshness => {
      const source = entry as ProviderComplianceSourceEntry;
      const remaining = daysUntilStale(source, now);
      const retrievedAtUtcMidnight = Date.parse(`${source.retrievedAt.slice(0, 10)}T00:00:00.000Z`);
      return {
        sourceKey: source.sourceKey,
        title: source.title,
        publisher: source.publisher,
        url: source.url,
        sourceType: source.sourceType,
        retrievedAt: source.retrievedAt,
        maxAgeDays: source.maxAgeDays,
        staleFrom: isoDate(retrievedAtUtcMidnight + (source.maxAgeDays + 1) * MS_PER_DAY),
        daysUntilStale: remaining,
        status: classify(remaining),
      };
    })
    .sort((a, b) => a.daysUntilStale - b.daysUntilStale);

  const stale = sources.filter((s) => s.status === "stale");
  const expiringSoon = sources.filter((s) => s.status === "expiring-soon");

  return {
    sources,
    expiringSoon,
    stale,
    worst: stale.length > 0 ? "stale" : expiringSoon.length > 0 ? "expiring-soon" : "fresh",
  };
}
