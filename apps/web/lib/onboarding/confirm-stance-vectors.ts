// Owner confirmation of the archetype stance vectors (BI-D6DC2432,
// EP-0AF96937 stance-onboarding design §5/§7).
//
// Confirming is the lever that grants autonomy: the archetype defaults seed at
// unconfirmed B/0.6 (effective 0.45 — clears nothing); when the owner confirms
// or adjusts a card, the vector's page is (re)published + embedded and its
// WHOLE class bundle upgrades to owner-confirmed A/0.9 — including the seeded
// identity pages (mission / who-we-serve / how-we-decide / supply-chain) that
// echo into the same classes. Bundle semantics are load-bearing: the gate's
// confidence is the MEAN of the class's materials, so a confirmed vector next
// to an unconfirmed identity echo would sit BELOW the recommend band (the
// mixed-drag hazard proven in stance-onboarding.simulation.test.ts).
//
// Pure derivation lives here (unit-tested); the server action wraps it.

import {
  STANCE_VECTOR_KEYS,
  type StanceVectorKey,
} from "./archetype-business-context";
import { STANCE_VECTOR_BUNDLES } from "./seed-org-wwwd-corpus";
import type { DecisionDomainClass } from "@/lib/decision-perspective/types";

export type ConfirmedVectorInput = {
  key: StanceVectorKey;
  /** The stance text as confirmed (default or owner-adjusted). */
  stance: string;
  /** Authority ceiling in whole USD; null/undefined = no ceiling sentence. */
  ceilingUsd?: number | null;
};

export type ConfirmStanceValidation =
  | { ok: true; vectors: Array<{ key: StanceVectorKey; stance: string; ceilingUsd: number | null }> }
  | { ok: false; error: string };

export function validateConfirmStanceVectors(input: {
  vectors: ConfirmedVectorInput[];
}): ConfirmStanceValidation {
  if (!Array.isArray(input.vectors) || input.vectors.length === 0) {
    return { ok: false, error: "Nothing to confirm." };
  }
  const seen = new Set<string>();
  const vectors: Array<{ key: StanceVectorKey; stance: string; ceilingUsd: number | null }> = [];
  for (const v of input.vectors) {
    if (!(STANCE_VECTOR_KEYS as readonly string[]).includes(v.key)) {
      return { ok: false, error: `Unknown stance: ${String(v.key)}` };
    }
    if (seen.has(v.key)) {
      return { ok: false, error: `Duplicate stance: ${v.key}` };
    }
    seen.add(v.key);
    const stance = (v.stance ?? "").trim();
    if (stance.length < 20) {
      return { ok: false, error: "Each stance needs a sentence or two." };
    }
    const ceilingUsd =
      typeof v.ceilingUsd === "number" && Number.isFinite(v.ceilingUsd) && v.ceilingUsd > 0
        ? Math.round(v.ceilingUsd)
        : null;
    vectors.push({ key: v.key, stance, ceilingUsd });
  }
  return { ok: true, vectors };
}

/** The decision classes covered by a set of confirmed vectors. */
export function classesCoveredByVectors(keys: StanceVectorKey[]): DecisionDomainClass[] {
  const classes = new Set<DecisionDomainClass>();
  for (const key of keys) {
    for (const domainClass of STANCE_VECTOR_BUNDLES[key]) classes.add(domainClass);
  }
  return [...classes];
}

/**
 * The seeded identity pages that echo into each decision class (must mirror
 * the bundles in seed-org-wwwd-corpus buildPages). When a class is covered by
 * a confirmed vector, these class-mates upgrade too — the step's summary line
 * shows them, so confirming legitimately covers them.
 */
export const IDENTITY_PAGE_BUNDLES: Record<string, DecisionDomainClass[]> = {
  "org-mission": ["plan-readiness"],
  "org-who-we-serve": ["plan-readiness"],
  "org-how-we-decide": ["plan-readiness", "professional-practice"],
  "org-supply-chain": ["architecture-tradeoff"],
};

/**
 * Which identity pages (slug → classes) need upgrading given the covered
 * classes: a page upgrades only in the classes that are actually covered.
 */
export function identityUpgradesForClasses(
  covered: DecisionDomainClass[],
): Array<{ slug: string; domainClasses: DecisionDomainClass[] }> {
  const coveredSet = new Set(covered);
  const upgrades: Array<{ slug: string; domainClasses: DecisionDomainClass[] }> = [];
  for (const [slug, classes] of Object.entries(IDENTITY_PAGE_BUNDLES)) {
    const overlap = classes.filter((c) => coveredSet.has(c));
    if (overlap.length > 0) upgrades.push({ slug, domainClasses: overlap });
  }
  return upgrades;
}

/** Compose the published stance-page body for a confirmed vector. */
export function confirmedStanceBody(input: {
  title: string;
  stance: string;
  ceilingUsd: number | null;
  orgLabel: string;
}): { body: string; abstract: string } {
  const ceiling =
    input.ceilingUsd != null
      ? `\nAuthority ceiling: up to $${input.ceilingUsd} per case may be resolved without the owner; above that, the owner decides.`
      : "";
  return {
    body: [
      `# ${input.title}`,
      "",
      input.stance,
      ceiling,
      "",
      `Confirmed by ${input.orgLabel}'s owner. Coworkers act on this stance for everyday calls; adjust it any time in Decision governance.`,
    ].join("\n"),
    abstract: input.stance,
  };
}
