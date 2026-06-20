/**
 * Per-change disposition — Private/Public Change Segregation (EP-1A78BAE1).
 * Spec: docs/superpowers/specs/2026-06-18-private-public-change-segregation-design.md
 * Plan: docs/superpowers/plans/2026-06-19-contribution-model-2state-suggest-confirm.md
 *
 * A change ships with a disposition: "private" (default, fail-closed) or
 * "shareable". Only "shareable" changes may leave at public-hive egress. The
 * AI suggests a disposition from signals DPF already computes; the human makes
 * the final call. This file holds the pure suggestion logic (unit-tested) and
 * the fail-closed gate predicate; callers (contribute_to_hive, create_portal_pr)
 * enforce the gate at public-hive egress only.
 */

export type Disposition = "private" | "shareable";

export interface SuggestionInputs {
  /** designDoc.reusabilityAnalysis.scope, if known. */
  reusabilityScope?: "one_off" | "parameterizable" | "already_generic" | null;
  /** Count of org-specific / proprietary hits from the sanitization scan. */
  orgSpecificHits?: number;
  /** Whether the post-strip outbound diff is empty (everything was private-path). */
  outboundEmpty?: boolean;
}

export interface DispositionSuggestion {
  suggested: Disposition;
  reason: string;
}

/**
 * Suggest a disposition. Fail-closed: defaults to "private" unless the change
 * is clearly generic/reusable AND carries no org-specific content. The human
 * still confirms — this only pre-fills the recommendation.
 */
export function suggestDisposition(inputs: SuggestionInputs): DispositionSuggestion {
  const { reusabilityScope, orgSpecificHits = 0, outboundEmpty = false } = inputs;

  if (outboundEmpty) {
    return {
      suggested: "private",
      reason: "This change only affects parts of your system marked private — nothing to share.",
    };
  }
  if (orgSpecificHits > 0) {
    return {
      suggested: "private",
      reason: `Contains ${orgSpecificHits} piece(s) of business-specific content (names, pricing, or data) — suggest keeping it on your system.`,
    };
  }
  if (reusabilityScope === "one_off") {
    return {
      suggested: "private",
      reason: "Looks specific to your business — suggest keeping it on your system.",
    };
  }
  if (reusabilityScope === "already_generic") {
    return {
      suggested: "shareable",
      reason: "Looks broadly reusable and carries no business-specific content — a good candidate to share.",
    };
  }
  if (reusabilityScope === "parameterizable") {
    return {
      suggested: "shareable",
      reason: "Could benefit others once generalized, and carries no business-specific content — consider sharing.",
    };
  }
  // Unknown reusability + clean: lean conservative (private) — fail-closed.
  return {
    suggested: "private",
    reason: "Not clearly reusable — suggest keeping it on your system unless you intend to share it.",
  };
}

/**
 * Fail-closed gate predicate for public-hive egress. A change may leave only
 * when explicitly "shareable". Anything else (incl. the default "private" and
 * any unknown value) is blocked.
 */
export function mayShareToPublicHive(disposition: string | null | undefined): boolean {
  return disposition === "shareable";
}

/** Plain-language refusal message when a private change is blocked at egress. */
export function privateDispositionBlockMessage(suggestionReason?: string | null): string {
  const base =
    "This change is set to stay on your system, so it was not shared with the community. " +
    "To share it, mark it shareable (Admin > Platform Development, or ask the coworker to share this change).";
  return suggestionReason ? `${base}\n\n${suggestionReason}` : base;
}
