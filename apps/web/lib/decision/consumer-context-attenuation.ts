// BI-5BB1A364: attenuate-not-exclude for a contextless `principle_decide`
// caller, plus the profession-local-axis lever from BI-AA7D80FE (#3481).
//
// Root cause (confirmed by the reporting thread): `listPrinciplesByTier`
// filters retrieval on tier/organizationId/appliesTo/ringScope only.
// `principleConsumerContexts` is stored but was never read as a filter, so a
// `route-domain-specific` commandment like `no-hardcoded-colors` — a UI/CSS
// rule whose vector carries only generic axes (long_term_maintainability,
// reusability, schema_grounding) — is retrieved for EVERY decision and votes
// at full commandment weight (1.0) even when the decision has no UI content.
//
// Two independent, composable levers close this:
//
// 1. Retrieval-side: `listPrinciplesByTier`'s new `consumerContexts` param
//    (mirrors the existing `ringScope` contract exactly — empty passes,
//    intersection otherwise) EXCLUDES a route-domain-specific row when the
//    caller declares a context that doesn't match. See wiki-store.ts.
//
// 2. Scoring-side (this module): when the caller declares NO context at all
//    — today's default, since no principle_decide caller threads
//    `consumerContexts` yet — retrieval still "consults everything" for
//    backward compat. A route-domain-specific commandment reaching the
//    ledger that way gets its WEIGHT attenuated rather than excluded, so it
//    can still surface (a UI rule is never fully irrelevant) without
//    co-ranking as a top contributor on an unrelated decision.
//
// The profession-local share of the SAME commandment's dimension vector
// compounds into the same multiplier: `reusability` and `schema_grounding`
// (BI-AA7D80FE / #3481) are profession-local to `software-engineer`, and a
// vector built mostly from those axes is doubly non-topical for a decision
// that has no declared context. Scoping this compound lever to the
// contextless route-domain-specific bucket (rather than applying it to every
// commandment platform-wide) is a deliberate, conservative choice: full
// caller-profession threading is explicitly future work (see the "Phase 2"
// note in packages/db/src/profession-local-axes.ts), and attenuating
// reusability/schema_grounding-heavy UNIVERSAL commandments too would be a
// much larger behavior change than this defect warrants.
//
// Weight-level attenuation (not per-axis vector scaling) is deliberate too:
// computeStructuredAlignment normalizes by the sum of |vector[dim]| across
// ALL of a principle's dims, including ones the option never scores. Shrinking
// an unscored axis's magnitude in place REDUCES the denominator without
// touching the numerator, which paradoxically RAISES the normalized alignment
// for options that don't score that axis — the opposite of "attenuate".
// Scaling the principle's overall `weight` (the multiplier on
// `alignment` in `contribution = weight × alignment`) avoids that inversion:
// alignment math is untouched, only how much the resulting alignment counts
// toward the composite is reduced.

import { isSpineDimension } from "@dpf/db/dimension-scope";
import { isPrincipleDimension } from "@dpf/db/wiki-taxonomy";

/**
 * Route-domain-specific commandment, no context declared or matched by the
 * caller: retained at 30% weight. Non-zero on purpose — a UI/CSS commandment
 * is never IRRELEVANT to an architecture decision, just not the strongest
 * signal; attenuate-not-exclude per BI-5BB1A364 scope item 2.
 */
export const ROUTE_DOMAIN_CONTEXTLESS_ATTENUATION = 0.3;

/**
 * Floor multiplier applied to the profession-local SHARE of a principle's
 * dimension vector magnitude (see `professionLocalShare`). A vector that is
 * 100% profession-local axes retains this fraction of its weight on top of
 * whatever `ROUTE_DOMAIN_CONTEXTLESS_ATTENUATION` already removed; a vector
 * that is 100% spine axes is untouched by this lever.
 */
export const PROFESSION_LOCAL_AXIS_ATTENUATION = 0.5;

/**
 * Fraction of a dimension vector's total magnitude that comes from
 * profession-local axes (BI-AA7D80FE), by `Σ|value|`. Unknown (non-registry)
 * keys are ignored — same treatment as `projectVectorOntoSpine`. Returns 0
 * for an empty or all-zero vector (nothing to attenuate).
 */
export function professionLocalShare(
  dimensionVector: Record<string, number>,
): number {
  let total = 0;
  let local = 0;
  for (const [key, value] of Object.entries(dimensionVector)) {
    if (!isPrincipleDimension(key)) continue;
    const abs = Math.abs(value);
    total += abs;
    if (!isSpineDimension(key)) local += abs;
  }
  return total === 0 ? 0 : local / total;
}

/**
 * Multiplier in (0, 1] from the profession-local share of a vector.
 * `1 - share × (1 - floor)`: share 0 → 1 (no attenuation); share 1 → floor.
 */
export function professionLocalAttenuationFactor(
  dimensionVector: Record<string, number>,
): number {
  const share = professionLocalShare(dimensionVector);
  return 1 - share * (1 - PROFESSION_LOCAL_AXIS_ATTENUATION);
}

export type ConsumerContextAttenuationInput = {
  /**
   * `principleConsumerArchetype` column value. NO LONGER GATES this lever —
   * it encodes populations, not route/domain (see the note on
   * `consumerContextWeightMultiplier`). Retained on the input so callers keep
   * passing it and the reason it is not consulted stays discoverable here
   * rather than becoming folklore.
   */
  consumerArchetype?: string | null | undefined;
  /** The row's own `principleConsumerContexts`. Empty/undefined for non-route archetypes and un-backfilled rows. */
  principleConsumerContexts: readonly string[] | null | undefined;
  /** The caller's declared `consumerContexts`, or undefined when the caller declared none. */
  callerConsumerContexts: readonly string[] | undefined;
  /** The commandment's `principleDimensionVector`, for the profession-local lever. Empty object if absent. */
  dimensionVector: Record<string, number>;
};

/**
 * The combined weight multiplier for a single commandment row.
 *
 * KEYED ON DECLARED CONTEXTS, NOT ON ARCHETYPE (BI-86EF5900 follow-up).
 * This lever originally gated on `principleConsumerArchetype ===
 * "route-domain-specific"` and was therefore INERT: measured across all 96
 * kernel principle pages the archetype distribution is universal 72,
 * ai-coworker-universal 23, specialist 1 — route-domain-specific ZERO. The
 * function returned 1 on its first line for every principle, always, so the
 * defect BI-5BB1A364 set out to fix was never actually mitigated.
 *
 * The archetype could not carry this: per the seed's coherence matrix
 * (seed-wiki-kernel.ts, spec §8A.1) `universal` REQUIRES two or more
 * `principleAppliesTo` populations, so archetype encodes WHICH POPULATIONS a
 * principle binds. `principleConsumerContexts` encodes WHICH ROUTE/DOMAIN.
 * Those axes are orthogonal: `no-hardcoded-colors` is correctly `universal`
 * (all three populations must bind theme tokens) AND correctly `ui`-scoped.
 * Gating a domain lever on a population field made route-domain-specific
 * structurally unreachable for any rule spanning populations — which is
 * nearly all of them.
 *
 * Keying on the contexts field also makes this lever agree with the
 * retrieval-side filter, which already keys on `principleConsumerContexts`
 * alone with no archetype check (wiki-store.ts `listPrinciplesByTier`). The
 * two halves of BI-5BB1A364 disagreeing is what left the gap.
 *
 * - The row declares no `principleConsumerContexts` → 1. No declared domain
 *   scope means the rule is domain-universal; unchanged, and the majority
 *   case (53 of 96 pages).
 * - Caller declared NO context → attenuate (contextless-caller bucket,
 *   BI-5BB1A364 scope item 2) rather than exclude.
 * - Caller declared a context that INTERSECTS this row's contexts → 1 (the
 *   topical match is confirmed; full weight).
 * - Caller declared a context that does NOT intersect → 0. Retrieval
 *   (`listPrinciplesByTier`'s `consumerContexts` filter) should already have
 *   excluded this row entirely; scoring it at 0 here is defense-in-depth for
 *   the same reason `principleMatchesRingScope` re-checks ring scope after
 *   retrieval — a narrow test mock or a retrieval path that didn't thread
 *   the filter through must not silently let a non-matching row vote at full
 *   weight.
 */
export function consumerContextWeightMultiplier(
  input: ConsumerContextAttenuationInput,
): number {
  const rowContexts = input.principleConsumerContexts ?? [];
  if (rowContexts.length === 0) return 1;

  const callerContexts = input.callerConsumerContexts ?? [];
  if (callerContexts.length === 0) {
    return (
      ROUTE_DOMAIN_CONTEXTLESS_ATTENUATION *
      professionLocalAttenuationFactor(input.dimensionVector)
    );
  }

  const intersects = rowContexts.some((c) => callerContexts.includes(c));
  return intersects ? 1 : 0;
}
