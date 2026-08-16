// Read side of the trust-envelope citation record (BI-8192557E phase 2a).
//
// `citationsToSources` writes the structured locator onto
// DecisionInteraction.sources; this module reads it back into the
// `RecordedCitation[]` shape `reverifyCitations` consumes. It is a pure
// decoder — it resolves nothing and verifies nothing, so it carries no
// separation-of-duties concern: the independent verification pass (phase 2b)
// supplies its own resolver.
//
// FAIL-CLOSED IS THE WHOLE POINT. Of the decision rows on a live install
// today, none carry a locator — they predate the write. A row with no
// locator must be reported as UNVERIFIABLE, never folded into the verified
// set and never counted as a confirmation. So a source without a
// re-resolvable locator is split out into `unverifiable` rather than being
// dropped silently (which would let "0 citations, 0 failures" read as clean)
// or emitted as a citation with an empty locator (which would let the
// re-verifier's own resolver decide, and a permissive resolver would confirm it).

import type { RecordedCitation } from "@/lib/decision/evidence-reverifier";
import { normalizeLocator } from "@/lib/deliberation/evidence";
import type { DecisionEvaluationSource } from "@/lib/decision-perspective/types";

/** Why a recorded source cannot be handed to the re-verifier. */
export type UnverifiableReason =
  /** Row predates locator persistence, or the gate never recorded one. */
  | "no-locator"
  /** A locator is present but no longer normalizes to a StructuredLocator. */
  | "malformed-locator"
  /** No (option, dimension) binding, so a degrade could not be attributed. */
  | "no-dimension-binding";

export type UnverifiableSource = {
  materialId: string;
  sourceType: string;
  reason: UnverifiableReason;
};

export type RecordedCitationSet = {
  /** Sources that carry everything re-resolution needs. */
  citations: RecordedCitation[];
  /** Sources that do NOT — explicitly unverifiable, never treated as verified. */
  unverifiable: UnverifiableSource[];
  /**
   * True when at least one source was recorded and NONE of them can be
   * re-verified — i.e. the decision's evidence is opaque to Axis 4. Callers
   * must not present such a decision as re-verified.
   */
  whollyUnverifiable: boolean;
};

/**
 * Decode a decision's recorded `sources` into re-verifiable citations plus an
 * explicit unverifiable remainder.
 *
 * A source qualifies only when it carries a normalizable `StructuredLocator`
 * AND the (optionId, dimensionKey) binding a degrade verdict attaches to —
 * `reverifyCitations` reports degrades per (option, dimension), so a citation
 * that cannot name its pair could be checked but never acted on.
 */
export function recordedCitationsFromSources(
  sources: DecisionEvaluationSource[] | null | undefined,
): RecordedCitationSet {
  const citations: RecordedCitation[] = [];
  const unverifiable: UnverifiableSource[] = [];

  for (const source of sources ?? []) {
    const identity = { materialId: source.materialId, sourceType: source.sourceType };

    if (source.locator === undefined || source.locator === null) {
      unverifiable.push({ ...identity, reason: "no-locator" });
      continue;
    }
    // Re-normalize rather than trusting the stored shape: `sources` is jsonb, so
    // the persisted value is whatever was written, including by an older or
    // hand-edited writer.
    const locator = normalizeLocator(source.locator);
    if (!locator) {
      unverifiable.push({ ...identity, reason: "malformed-locator" });
      continue;
    }

    const { optionId, dimensionKey } = resolveBinding(source);
    if (!optionId || !dimensionKey) {
      unverifiable.push({ ...identity, reason: "no-dimension-binding" });
      continue;
    }

    citations.push({
      optionId,
      dimensionKey,
      locator,
      recordedExcerpt: source.excerpt ?? null,
    });
  }

  return {
    citations,
    unverifiable,
    whollyUnverifiable: citations.length === 0 && unverifiable.length > 0,
  };
}

/**
 * Recover the (option, dimension) pair. Explicit fields win; otherwise fall back
 * to the `materialId` convention the ledger writes (`${optionId}:${dimensionKey}`),
 * which is the only binding rows written before the explicit fields carry.
 */
function resolveBinding(source: DecisionEvaluationSource): {
  optionId: string | null;
  dimensionKey: string | null;
} {
  if (source.optionId && source.dimensionKey) {
    return { optionId: source.optionId, dimensionKey: source.dimensionKey };
  }
  const separator = source.materialId.indexOf(":");
  if (separator <= 0 || separator === source.materialId.length - 1) {
    return { optionId: null, dimensionKey: null };
  }
  return {
    optionId: source.materialId.slice(0, separator),
    dimensionKey: source.materialId.slice(separator + 1),
  };
}
