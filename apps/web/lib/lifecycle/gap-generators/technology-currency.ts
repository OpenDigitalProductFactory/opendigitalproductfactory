// Pure utility library — no server imports. Safe in tests and client components.
//
// Technology-currency (obsolescence / EOL) gap generator (EP-LIFECYCLE / slice 4).
// Spec: docs/superpowers/specs/2026-06-07-unified-lifecycle-backbone-design.md §7.
//
// The first cross-cutting gap generator and the template for the rest (vulnerability,
// data-quality, operational). It reads the canonical `currency` axis (derived by
// resolveLifecycle from supportStatus + supportEndsAt) over current-state manifested
// things and raises one technology-currency gap per non-current thing. This is the
// amalgamation in action: obsolescence becomes a gap in the same register as everything
// else, instead of a separate asset-management tool.

import type { CanonicalLifecycle, Currency } from "../../lifecycle";
import type { GovernedThingKind } from "../../governed-thing-ref";
import { buildGapKey, type GapSeverity, type LifecycleGapInput } from "../gaps";

/** A current-state manifested governed thing with its resolved canonical lifecycle. */
export type CurrencyMember = {
  kind: GovernedThingKind;
  id: string;
  name: string;
  canonical: CanonicalLifecycle;
  digitalProductId?: string | null;
  evidenceRef?: string;
};

const SEVERITY_BY_CURRENCY: Record<Exclude<Currency, "current">, GapSeverity> = {
  "approaching-eol": "medium",
  unsupported: "high",
  "end-of-life": "critical",
};

const LABEL_BY_CURRENCY: Record<Exclude<Currency, "current">, string> = {
  "approaching-eol": "approaching end-of-life",
  unsupported: "unsupported",
  "end-of-life": "end-of-life",
};

/**
 * Generate technology-currency gaps for the supplied current-state members. Members whose
 * canonical currency is null or "current" produce no gap. Deterministic and pure; the
 * caller feeds the result to reconcileGaps().
 */
export function generateTechnologyCurrencyGaps(members: CurrencyMember[]): LifecycleGapInput[] {
  const gaps: LifecycleGapInput[] = [];
  for (const m of members) {
    const currency = m.canonical.currency;
    if (!currency || currency === "current") continue;

    const severity = SEVERITY_BY_CURRENCY[currency];
    const ref = { kind: m.kind, id: m.id };
    gaps.push({
      gapKey: buildGapKey({ dimension: "technology-currency", ref }),
      kind: "change",
      dimension: "technology-currency",
      severity,
      scopeLevel: m.digitalProductId ? "product" : "portfolio",
      governedThingKind: m.kind,
      governedThingId: m.id,
      title: `${m.name} is ${LABEL_BY_CURRENCY[currency]}`,
      detail: `${m.name} has reached "${currency}" technology currency and should be remediated, upgraded, or retired before it poses operational, security, or compliance risk.`,
      evidenceRef: m.evidenceRef,
      digitalProductId: m.digitalProductId ?? undefined,
    });
  }
  return gaps;
}
