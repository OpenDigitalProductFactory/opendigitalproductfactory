// Trust-envelope external verifier — re-check cited evidence against its real
// source (BI-70FF9114, EP-VERIFICATION-INTEGRITY; spec §2 Axis 4).
//
// Reuses the separation-of-duties shape of verified-finding-review.ts: an
// INDEPENDENT pass (no access to the original scorer's reasoning) re-resolves
// each recorded StructuredLocator against the live source and compares the live
// excerpt to the recorded one. A locator that no longer resolves, or whose
// source no longer contains the recorded excerpt, DEGRADES the affected
// dimension to unevidenced (feeding Axis 1) and flags the decision.
//
// Resolution is injected (`LocatorResolver`) so this stays pure and testable and
// the module never hard-codes a filesystem/DB/network dependency; each surface
// supplies a resolver for the sourceTypes it can reach. Verifier identity is an
// audit field, never a gate input (governance-approves-evidence-not-provenance).

import type { StructuredLocator } from "@/lib/deliberation/evidence";

export type ReVerificationVerdict = "confirmed" | "degraded" | "unresolved";

/** What an independent resolver returns for one locator. */
export type LocatorResolution = {
  /** Did the locator resolve to a real artifact at all. */
  resolved: boolean;
  /** The excerpt currently present at the locator (null if unresolved). */
  liveExcerpt: string | null;
};

export type LocatorResolver = (locator: StructuredLocator) => Promise<LocatorResolution>;

export type RecordedCitation = {
  optionId: string;
  dimensionKey: string;
  locator: StructuredLocator;
  recordedExcerpt: string | null;
};

export type CitationReVerification = {
  optionId: string;
  dimensionKey: string;
  locator: StructuredLocator;
  recordedExcerpt: string | null;
  liveExcerpt: string | null;
  resolved: boolean;
  excerptMatch: boolean;
  verdict: ReVerificationVerdict;
};

export type ReVerificationReport = {
  results: CitationReVerification[];
  /** (option,dimension) pairs whose evidence no longer holds — degrade to unevidenced. */
  degrade: Array<{ optionId: string; dimensionKey: string }>;
  confirmed: number;
  degraded: number;
  unresolved: number;
  /** True when every citation re-confirmed — safe to keep the decision as-is. */
  allConfirmed: boolean;
};

/** Whitespace-insensitive, case-sensitive containment: does live still support recorded? */
export function excerptSupported(recorded: string | null, live: string | null): boolean {
  if (!recorded) return true; // nothing to contradict
  if (!live) return false;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  return norm(live).includes(norm(recorded));
}

function verdictFor(resolved: boolean, excerptMatch: boolean): ReVerificationVerdict {
  if (!resolved) return "unresolved";
  return excerptMatch ? "confirmed" : "degraded";
}

/**
 * Re-verify every recorded citation with the injected resolver. Fail-closed on a
 * resolver error: a citation whose resolver throws is treated as `unresolved`
 * (degrade), never silently confirmed.
 */
export async function reverifyCitations(
  citations: RecordedCitation[],
  resolve: LocatorResolver,
): Promise<ReVerificationReport> {
  const results: CitationReVerification[] = [];
  for (const c of citations) {
    let resolution: LocatorResolution;
    try {
      resolution = await resolve(c.locator);
    } catch {
      resolution = { resolved: false, liveExcerpt: null };
    }
    const excerptMatch = resolution.resolved && excerptSupported(c.recordedExcerpt, resolution.liveExcerpt);
    results.push({
      optionId: c.optionId,
      dimensionKey: c.dimensionKey,
      locator: c.locator,
      recordedExcerpt: c.recordedExcerpt,
      liveExcerpt: resolution.liveExcerpt,
      resolved: resolution.resolved,
      excerptMatch,
      verdict: verdictFor(resolution.resolved, excerptMatch),
    });
  }

  const degrade = results
    .filter((r) => r.verdict !== "confirmed")
    .map((r) => ({ optionId: r.optionId, dimensionKey: r.dimensionKey }));

  const confirmed = results.filter((r) => r.verdict === "confirmed").length;
  const degraded = results.filter((r) => r.verdict === "degraded").length;
  const unresolved = results.filter((r) => r.verdict === "unresolved").length;

  return {
    results,
    degrade,
    confirmed,
    degraded,
    unresolved,
    allConfirmed: results.length > 0 && degrade.length === 0,
  };
}
