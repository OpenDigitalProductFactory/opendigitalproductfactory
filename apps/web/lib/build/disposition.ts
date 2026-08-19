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
export type ContributionRecommendation = "keep_local" | "share" | "generalize_first";
export type ContributionSignalScore = "high" | "medium" | "low" | "unknown";

export interface SuggestionInputs {
  /** designDoc.reusabilityAnalysis.scope, if known. */
  reusabilityScope?: "one_off" | "parameterizable" | "already_generic" | null;
  /** designDoc.reusabilityAnalysis.contributionReadiness, if known. */
  contributionReadiness?: "high" | "medium" | "low" | null;
  /** How well this change advances the DPF project itself. */
  projectViability?: ContributionSignalScore | null;
  /** How broadly this appears useful across target archetypes / market verticals. */
  archetypeMarketFit?: ContributionSignalScore | null;
  /** Confidence in the viability analysis; unknown keeps the recommendation fail-closed. */
  confidence?: ContributionSignalScore | null;
  /** Count of org-specific / proprietary hits from the sanitization scan. */
  orgSpecificHits?: number;
  /** Whether the post-strip outbound diff is empty (everything was private-path). */
  outboundEmpty?: boolean;
}

export interface DispositionSuggestion {
  suggested: Disposition;
  recommendation: ContributionRecommendation;
  reason: string;
  evidence: string[];
}

function scoreAtLeast(score: ContributionSignalScore | null | undefined, floor: "medium" | "high"): boolean {
  if (floor === "high") return score === "high";
  return score === "high" || score === "medium";
}

function hasExplicitViabilityAnalysis(inputs: SuggestionInputs): boolean {
  return !!inputs.projectViability && !!inputs.archetypeMarketFit && !!inputs.confidence
    && inputs.projectViability !== "unknown"
    && inputs.archetypeMarketFit !== "unknown"
    && inputs.confidence !== "unknown";
}

/**
 * Suggest a disposition. Fail-closed: defaults to "private" unless the change
 * is clearly generic/reusable AND carries no org-specific content. The human
 * still confirms — this only pre-fills the recommendation.
 */
export function suggestDisposition(inputs: SuggestionInputs): DispositionSuggestion {
  const {
    reusabilityScope,
    contributionReadiness = null,
    projectViability,
    archetypeMarketFit,
    confidence,
    orgSpecificHits = 0,
    outboundEmpty = false,
  } = inputs;

  if (outboundEmpty) {
    return {
      suggested: "private",
      recommendation: "keep_local",
      reason: "This change only affects parts of your system marked private — nothing to share.",
      evidence: ["Outbound public diff is empty after private-path stripping."],
    };
  }
  if (orgSpecificHits > 0) {
    return {
      suggested: "private",
      recommendation: "keep_local",
      reason: `Contains ${orgSpecificHits} piece(s) of business-specific content (names, pricing, or data) — suggest keeping it on your system.`,
      evidence: [`Sanitization found ${orgSpecificHits} must-fix business-specific item(s).`],
    };
  }

  const evidence = [
    `Project viability: ${projectViability ?? "unknown"}.`,
    `Archetype/market fit: ${archetypeMarketFit ?? "unknown"}.`,
    `Reuse scope: ${reusabilityScope ?? "unknown"}.`,
    `Contribution readiness: ${contributionReadiness ?? "unknown"}.`,
  ];

  if (!hasExplicitViabilityAnalysis(inputs)) {
    return {
      suggested: "private",
      recommendation: "keep_local",
      reason: "No contribution viability assessment was captured yet — keep this change on your system until the coworker can assess project fit and archetype/market usefulness.",
      evidence,
    };
  }

  if (reusabilityScope === "one_off") {
    return {
      suggested: "private",
      recommendation: "keep_local",
      reason: "Looks specific to your business — suggest keeping it on your system.",
      evidence,
    };
  }

  const viableForProject = scoreAtLeast(projectViability, "medium");
  const usefulInMarket = scoreAtLeast(archetypeMarketFit, "medium");
  const confidentEnough = scoreAtLeast(confidence, "medium");
  const strongValue = scoreAtLeast(projectViability, "high") && scoreAtLeast(archetypeMarketFit, "high");

  if (!viableForProject || !usefulInMarket || !confidentEnough) {
    return {
      suggested: "private",
      recommendation: "keep_local",
      reason: "The coworker does not yet see enough project, archetype, and market evidence to recommend sharing — keep this change on your system.",
      evidence,
    };
  }

  if (reusabilityScope === "parameterizable" && contributionReadiness !== "high") {
    return {
      suggested: "private",
      recommendation: "generalize_first",
      reason: strongValue
        ? "This could help the community across relevant archetypes and markets, but it should be generalized before sharing."
        : "This may help others, but it should be generalized before sharing.",
      evidence,
    };
  }

  if (reusabilityScope === "already_generic") {
    return {
      suggested: "shareable",
      recommendation: "share",
      reason: "Looks broadly reusable, viable for the DPF project, and useful across relevant archetypes/markets — a good candidate to share.",
      evidence,
    };
  }
  if (reusabilityScope === "parameterizable") {
    return {
      suggested: "shareable",
      recommendation: "share",
      reason: "Looks parameterized enough to benefit others across relevant archetypes/markets, and carries no business-specific content — consider sharing.",
      evidence,
    };
  }
  // Unknown reusability + clean: lean conservative (private) — fail-closed.
  return {
    suggested: "private",
    recommendation: "keep_local",
    reason: "Not clearly reusable — suggest keeping it on your system unless you intend to share it.",
    evidence,
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
