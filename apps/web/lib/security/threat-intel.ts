// EP-SOVEREIGN-SOC P1 — threat-intel index + observable matching (pure).
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §4.3.
//
// The correlation sweep loads the active ThreatIndicator set once, builds an
// O(1) value index (dropping expired indicators), and matches event observable
// values against it. Pure of Prisma so it is trivially testable; the P1 caller
// supplies the rows. Used both by detection (the `matchThreatIndicator`
// predicate) and by enrichment (IOC tagging).

import type { IndicatorMatch } from "./enrichment";

export interface ThreatIndicatorView {
  indicatorKey: string;
  indicatorType: string;
  value: string;
  source: string;
  confidence: string;
  severity?: string | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
}

/** A loaded, validity-filtered indicator index keyed by indicator value. */
export type IndicatorIndex = Map<string, ThreatIndicatorView>;

/**
 * Build a value→indicator index, dropping indicators outside their validity
 * window. When two indicators share a value the higher-confidence / later one
 * wins is NOT attempted here — first-write wins; dedupe upstream if it matters.
 */
export function buildIndicatorIndex(
  indicators: ThreatIndicatorView[],
  now: Date,
): IndicatorIndex {
  const index: IndicatorIndex = new Map();
  for (const ind of indicators) {
    if (ind.validFrom && ind.validFrom > now) continue;
    if (ind.validUntil && ind.validUntil < now) continue;
    if (!index.has(ind.value)) index.set(ind.value, ind);
  }
  return index;
}

/** Match a set of observable values against the index. */
export function matchIndicatorValues(
  values: string[],
  index: IndicatorIndex,
): IndicatorMatch[] {
  const matches: IndicatorMatch[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    const ind = index.get(v);
    if (ind) {
      matches.push({
        indicatorType: ind.indicatorType,
        value: ind.value,
        source: ind.source,
        severity: ind.severity ?? undefined,
      });
    }
  }
  return matches;
}
