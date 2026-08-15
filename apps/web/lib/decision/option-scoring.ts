// Phase 2 Task 2.5 of the principles-as-wiki-kind plan: principle_decide
// core math. Pure module — no I/O, no logging side effects. The Phase 2
// Task 2.7 MCP handler is responsible for retrieving principles and
// embeddings, then calling these primitives.

import {
  evaluateAutonomyEligibility,
  measureFeatureCoverage,
} from "./mcda-quality-gates";
//
// Spec: docs/superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md §11
// Plan: docs/superpowers/plans/2026-05-12-principles-as-wiki-kind.md (Phase 2 Tasks 2.5)
//
// Decision algorithm (spec §11.2):
//   1. Score each option against each principle (structured if both have
//      compatible dimension data; otherwise semantic fallback via embedding
//      cosine).
//   2. Composite per option = Σ (principle.weight × alignment).
//   3. Caller picks argmax; this module returns the full contribution
//      ledger so callers can render the why, not just the what.

// ─── Public types ───────────────────────────────────────────────────────────

export type DecisionPrinciple = {
  id: string;
  name: string;
  /** commandment | core | contextual (loose type for storage round-trips). */
  tier: string;
  /** Effective decision weight (from tier default or override). */
  weight: number;
  /** Signed map of dimension key → weight in [-1, 1]. Empty triggers semantic fallback. */
  dimensionVector: Record<string, number>;
  /** Optional embedding of principleDirection for semantic fallback. */
  directionEmbedding?: number[];
};

export type DecisionOption = {
  id: string;
  description: string;
  /** Map of dimension key → 0..1 score. Only structurally compared against principles whose dimensionVector overlaps. */
  features: Record<string, number>;
  /** Optional embedding of the option description for semantic fallback. */
  embedding?: number[];
};

export type AlignmentMode = "structured" | "semantic";

export type AlignmentResult = {
  alignment: number;
  mode: AlignmentMode;
  /** Dimensions the principle cared about but the option did not score. */
  missingDimensions: string[];
};

export type PrincipleContribution = {
  principleId: string;
  principleName: string;
  tier: string;
  weight: number;
  mode: AlignmentMode;
  alignment: number;
  /** weight × alignment — the row's contribution to the composite. */
  contribution: number;
  /** Dimensions present in the principle's vector but absent from the option (structured mode only). */
  missingDimensions?: string[];
};

export type DecisionOptionScore = {
  optionId: string;
  composite: number;
  contributions: PrincipleContribution[];
};

// ─── Structured alignment ───────────────────────────────────────────────────

/**
 * Normalized dot product over the principle's dimension axes:
 *
 *   alignment = Σ option[dim] × vector[dim] / Σ |vector[dim]|
 *
 * Missing option dimensions count as 0 (no contribution along that axis)
 * and are reported in `missingDimensions` so the caller can warn about
 * partial coverage. Returns alignment = 0 when the principle has no
 * dimensions at all — callers detect this and fall back to semantic mode.
 */
export function computeStructuredAlignment(
  option: DecisionOption,
  principle: DecisionPrinciple,
): AlignmentResult {
  const dims = Object.keys(principle.dimensionVector);
  if (dims.length === 0) {
    return { alignment: 0, mode: "structured", missingDimensions: [] };
  }

  let numerator = 0;
  let denominator = 0;
  const missingDimensions: string[] = [];
  for (const dim of dims) {
    const v = principle.dimensionVector[dim];
    const f = option.features[dim];
    denominator += Math.abs(v);
    if (typeof f === "number") {
      numerator += f * v;
    } else {
      missingDimensions.push(dim);
    }
  }

  const alignment = denominator === 0 ? 0 : numerator / denominator;
  return { alignment, mode: "structured", missingDimensions };
}

// ─── Semantic alignment fallback ────────────────────────────────────────────

/**
 * Cosine similarity between the option embedding and the principle's
 * `directionEmbedding`. Used when the principle has no `dimensionVector`
 * (or the caller has no features to score). Returns 0 when either side
 * is missing or has zero norm — the caller decides whether a 0 alignment
 * means "no signal" vs. "actively neutral".
 */
export function computeSemanticAlignment(
  option: DecisionOption,
  principle: DecisionPrinciple,
): AlignmentResult {
  const a = option.embedding;
  const b = principle.directionEmbedding;
  if (!a || !b || a.length !== b.length || a.length === 0) {
    return { alignment: 0, mode: "semantic", missingDimensions: [] };
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return { alignment: 0, mode: "semantic", missingDimensions: [] };
  }
  return {
    alignment: dot / (Math.sqrt(normA) * Math.sqrt(normB)),
    mode: "semantic",
    missingDimensions: [],
  };
}

// ─── Mode selection ─────────────────────────────────────────────────────────

/**
 * True when structured alignment has anything to say about this pair: the
 * principle declares at least one dimension AND the option scores at least one
 * of those same dimensions.
 *
 * When it returns false, `computeStructuredAlignment` is arithmetically pinned
 * to 0 (every term of the numerator is a missing feature), so a structured row
 * would report a confident-looking `alignment: 0` that carries no information.
 * The semantic path at least has a chance of signal.
 */
export function hasScoreableOverlap(
  option: DecisionOption,
  principle: DecisionPrinciple,
): boolean {
  const dims = Object.keys(principle.dimensionVector);
  if (dims.length === 0) return false;
  return dims.some((dim) => typeof option.features[dim] === "number");
}

// ─── Composite scoring + contribution ledger ────────────────────────────────

/**
 * For each option, compute the composite decision score across all
 * principles and return the contribution ledger.
 *
 * Selection of structured vs. semantic alignment considers BOTH sides:
 * - Structured when the principle declares a dimension vector AND the option
 *   scores at least one of those same dimensions — i.e. there is something to
 *   compare.
 * - Otherwise → semantic (uses both embeddings; zero if either is missing).
 *
 * The both-sides rule is load-bearing for the kernel-evolution discipline's
 * overlap scan (spec 2026-05-24 §4.3, BI-85341A52), which calls this engine with
 * a candidate principle's direction as a FEATURELESS option and reads the ledger
 * to find the closest existing principles. Selecting mode from the principle
 * side alone made that scan return an all-zero ledger against every vectored
 * principle — which is nearly the whole kernel — so the governed promotion gate
 * for a new principle could not be run at all. BI-3C1A6451 had already added
 * server-side embedding of the option description for exactly this case; the
 * embedding was computed and then never consulted, because the row had already
 * been routed to structured mode.
 *
 * Callers that DO supply overlapping features are unaffected: partial coverage
 * (one or more shared dimensions) still scores structured and still reports
 * `missingDimensions`. Only the zero-overlap case — where structured alignment
 * is arithmetically guaranteed to be 0 and says nothing — now falls through to
 * the semantic path.
 *
 * Tasks 2.6 (guardrails: tie-margin, commandment-conflict, semantic-
 * fallback coverage) consume this output downstream.
 */
// ─── Guardrails + advisory recommendation (Task 2.6) ───────────────────────

export type DecisionFlags = {
  /** The tie-margin threshold used for this decision (echo for inspectability). */
  tieMargin: number;
  /** Fraction of contributions that fell back to semantic alignment. */
  semanticFallbackRatio: number;
  /** "weak" when semanticFallbackRatio > semanticFallbackWarnRatio. */
  structuredCoverage: "strong" | "weak";
  /** True when any commandment contributed strongly negatively to the top option. */
  commandmentConflict: boolean;
  /** ids of commandments triggering the commandmentConflict flag. */
  commandmentConflictPrinciples: string[];
  /**
   * True when principles applied but every option × principle contribution
   * was exactly zero — typically options passed without `features` maps and
   * with no semantic path available (BI-5CE7CF0B). No recommendation is made
   * in this state: ranking all-zero composites just crowns input order.
   * Optional so older stored result shapes remain valid.
   */
  insufficientSignal?: boolean;
  /**
   * BI-1D23EC26: true when any option has fewer than minFeatureKeys feature
   * axes. Weak feature maps collapse structured discrimination — autonomy
   * must not treat the result as unattended-safe.
   */
  featureCoverageWeak?: boolean;
  /**
   * BI-1D23EC26: true when ±ε one-at-a-time principle weight swings flip the
   * recommended option (classic MCDA sensitivity). High-confidence claims
   * require stability under this check.
   */
  sensitivityUnstable?: boolean;
  /**
   * BI-1D23EC26: true only when recommendation is high-confidence, coverage
   * and structured signal are strong, sensitivity is stable, and no
   * commandment conflict. Agents use this — not mere recommendation presence —
   * as the unattended-proceed gate.
   */
  autonomyEligible?: boolean;
  /** Blockers when autonomyEligible is false (machine-readable). */
  autonomyBlockers?: string[];
  /** Inspectable coverage metrics (optional; present on full decide() path). */
  featureCoverage?: {
    minKeys: number;
    meanKeys: number;
    minFeatureKeysRequired: number;
    meanMissingDimensionRatio: number;
  };
  /** Inspectable sensitivity metrics (optional). */
  sensitivity?: {
    epsilon: number;
    flippingPrincipleCount: number;
  };
};

export type DecisionRecommendation = {
  optionId: string;
  composite: number;
  /** Composite of winner − composite of runner-up (0 when only one option). */
  margin: number;
  /** "low" when margin < tieMargin OR no principles applied. */
  confidence: "high" | "low";
};

export type DecisionResult = {
  recommendation: DecisionRecommendation | null;
  scores: DecisionOptionScore[];
  flags: DecisionFlags;
  /** Human-readable summary naming the winner and top contributors. */
  reasoning: string;
};

export type DecideConfig = {
  tieMargin?: number;
  semanticFallbackWarnRatio?: number;
  /**
   * A commandment contributes "strongly negatively" to the top option when
   * its contribution is below -commandmentConflictThreshold (default 0.5).
   * Tuned to catch values like -1.0 (full opposition under weight=1.0)
   * without flagging routine small negatives.
   */
  commandmentConflictThreshold?: number;
  /**
   * BI-1D23EC26: minimum feature axes each option should score. Default 3.
   * Below this, featureCoverageWeak fires and confidence is forced low.
   */
  minFeatureKeys?: number;
  /**
   * BI-1D23EC26: relative weight swing for sensitivity (±ε). Default 0.1.
   * Set to 0 to skip the sensitivity pass (tests / hot paths).
   */
  sensitivityEpsilon?: number;
};

const DEFAULT_TIE_MARGIN = 0.2;
const DEFAULT_SEMANTIC_FALLBACK_WARN_RATIO = 0.4;
const DEFAULT_COMMANDMENT_CONFLICT_THRESHOLD = 0.5;
const DEFAULT_MIN_FEATURE_KEYS = 3;
const DEFAULT_SENSITIVITY_EPSILON = 0.1;

/**
 * Top-level advisory decision call. Wraps buildOptionScores with the
 * three guardrails from spec section 11.3 and a human-readable reasoning
 * string. Returns a `recommendation: null` shape when no principles
 * apply or no options are supplied so callers can surface "no signal"
 * to the user rather than picking arbitrarily.
 */
export function decide(
  options: DecisionOption[],
  principles: DecisionPrinciple[],
  config: DecideConfig = {},
): DecisionResult {
  const tieMargin = config.tieMargin ?? DEFAULT_TIE_MARGIN;
  const semanticWarnRatio =
    config.semanticFallbackWarnRatio ?? DEFAULT_SEMANTIC_FALLBACK_WARN_RATIO;
  const commandmentConflictThreshold =
    config.commandmentConflictThreshold ??
    DEFAULT_COMMANDMENT_CONFLICT_THRESHOLD;
  const minFeatureKeys = config.minFeatureKeys ?? DEFAULT_MIN_FEATURE_KEYS;
  const sensitivityEpsilon =
    config.sensitivityEpsilon ?? DEFAULT_SENSITIVITY_EPSILON;

  const scores = buildOptionScores(options, principles);

  // No options or no principles → no signal; caller surfaces a "no
  // recommendation" message rather than picking arbitrarily.
  if (scores.length === 0 || principles.length === 0) {
    const flags: DecisionFlags = {
      tieMargin,
      semanticFallbackRatio: 0,
      structuredCoverage: "strong",
      commandmentConflict: false,
      commandmentConflictPrinciples: [],
      insufficientSignal: false,
      featureCoverageWeak: true,
      sensitivityUnstable: false,
      autonomyEligible: false,
      autonomyBlockers: ["no_recommendation"],
    };
    const reasoning =
      principles.length === 0
        ? "No applicable principles to evaluate. The decision needs an owner call instead of advisory math."
        : "No options supplied. Nothing to score.";
    return { recommendation: null, scores, flags, reasoning };
  }

  // Zero-signal guard (BI-5CE7CF0B): principles applied, but every single
  // contribution is exactly zero — no option carried features along any
  // scored dimension and the semantic path never fired. Ranking would crown
  // whichever option came first at composite 0.000; refuse instead and tell
  // the caller what was missing. Offsetting positive/negative contributions
  // that net to zero are genuine signal and do not trip this (the check is
  // per-contribution, not per-composite).
  const hasAnySignal = scores.some((s) =>
    s.contributions.some((c) => c.contribution !== 0),
  );
  if (!hasAnySignal) {
    const flags: DecisionFlags = {
      tieMargin,
      semanticFallbackRatio: 0,
      structuredCoverage: "strong",
      commandmentConflict: false,
      commandmentConflictPrinciples: [],
      insufficientSignal: true,
      featureCoverageWeak: true,
      sensitivityUnstable: false,
      autonomyEligible: false,
      autonomyBlockers: ["insufficient_signal", "feature_coverage_weak"],
    };
    return {
      recommendation: null,
      scores,
      flags,
      reasoning: `Insufficient signal: ${principles.length} principle(s) applied but every contribution is zero — the options carry no scoreable features and semantic alignment was unavailable. Provide per-option \`features\` maps (or embeddings), or decide by owner judgment.`,
    };
  }

  // Rank by composite descending.
  const ranked = [...scores].sort((a, b) => b.composite - a.composite);
  const winner = ranked[0];
  const runnerUpComposite = ranked[1]?.composite ?? winner.composite;
  const margin = winner.composite - runnerUpComposite;
  let confidence: "high" | "low" = margin < tieMargin ? "low" : "high";

  // Coverage: ratio of semantic-mode contributions across all option × principle pairs.
  const totalContribs = scores.reduce((sum, s) => sum + s.contributions.length, 0);
  const semanticContribs = scores.reduce(
    (sum, s) => sum + s.contributions.filter((c) => c.mode === "semantic").length,
    0,
  );
  const semanticFallbackRatio = totalContribs === 0 ? 0 : semanticContribs / totalContribs;
  const structuredCoverage: "strong" | "weak" =
    semanticFallbackRatio > semanticWarnRatio ? "weak" : "strong";

  // BI-1D23EC26: feature coverage (MCDA performance matrix completeness).
  const featureCoverage = measureFeatureCoverage(
    options,
    scores,
    minFeatureKeys,
  );
  const featureCoverageWeak = featureCoverage.weak;

  // BI-1D23EC26: ±ε one-at-a-time principle weight sensitivity.
  let sensitivityUnstable = false;
  let flippingPrincipleIds: string[] = [];
  if (sensitivityEpsilon > 0) {
    const factors = [
      1 + sensitivityEpsilon,
      Math.max(0, 1 - sensitivityEpsilon),
    ];
    for (const p of principles) {
      let flipped = false;
      for (const factor of factors) {
        const perturbed = principles.map((q) =>
          q.id === p.id ? { ...q, weight: q.weight * factor } : q,
        );
        const alt = buildOptionScores(options, perturbed);
        if (alt.length === 0) continue;
        const altWinner = [...alt].sort((a, b) => b.composite - a.composite)[0]
          ?.optionId;
        if (altWinner && altWinner !== winner.optionId) {
          flipped = true;
          break;
        }
      }
      if (flipped) flippingPrincipleIds.push(p.id);
    }
    sensitivityUnstable = flippingPrincipleIds.length > 0;
  }

  // Force low confidence when coverage/sensitivity fail — still recommend
  // for human review, but never claim high-confidence autonomy.
  if (featureCoverageWeak || sensitivityUnstable) {
    confidence = "low";
  }

  // Commandment conflict against the top option.
  const conflictingPrinciples = winner.contributions
    .filter(
      (c) =>
        c.tier === "commandment" &&
        c.contribution < -commandmentConflictThreshold,
    )
    .map((c) => c.principleId);

  const recommendation = {
    optionId: winner.optionId,
    composite: winner.composite,
    margin,
    confidence,
  };

  const provisionalFlags: DecisionFlags = {
    tieMargin,
    semanticFallbackRatio,
    structuredCoverage,
    commandmentConflict: conflictingPrinciples.length > 0,
    commandmentConflictPrinciples: conflictingPrinciples,
    insufficientSignal: false,
    featureCoverageWeak,
    sensitivityUnstable,
    featureCoverage: {
      minKeys: featureCoverage.minKeys,
      meanKeys: featureCoverage.meanKeys,
      minFeatureKeysRequired: featureCoverage.minFeatureKeysRequired,
      meanMissingDimensionRatio: featureCoverage.meanMissingDimensionRatio,
    },
    sensitivity: {
      epsilon: sensitivityEpsilon,
      flippingPrincipleCount: flippingPrincipleIds.length,
    },
  };

  const autonomy = evaluateAutonomyEligibility({
    recommendation,
    flags: provisionalFlags,
  });
  const flags: DecisionFlags = {
    ...provisionalFlags,
    autonomyEligible: autonomy.eligible,
    autonomyBlockers: autonomy.blockers,
  };

  // Reasoning: name the winner, the top two contributing principles, and
  // any quality warnings. Kept short — the contribution ledger carries
  // the full inspectable breakdown.
  const topContribs = [...winner.contributions]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2)
    .map((c) => c.principleName);
  const parts: string[] = [];
  parts.push(
    `Recommends ${winner.optionId} (composite ${winner.composite.toFixed(3)}, margin ${margin.toFixed(3)}).`,
  );
  if (topContribs.length > 0) {
    parts.push(`Strongest contributors: ${topContribs.join(", ")}.`);
  }
  if (confidence === "low") {
    parts.push(
      `Margin is below tieMargin (${tieMargin}) or MCDA quality gates failed — recommend owner review before committing.`,
    );
  }
  if (flags.commandmentConflict) {
    parts.push(
      `Commandment conflict: ${conflictingPrinciples.join(", ")} oppose the recommended option. Re-check whether the tension is intentional.`,
    );
  }
  if (flags.structuredCoverage === "weak") {
    parts.push(
      `Structured coverage is weak (${Math.round(semanticFallbackRatio * 100)}% semantic fallback). Consider supplying explicit dimension features on the options.`,
    );
  }
  if (featureCoverageWeak) {
    parts.push(
      `Feature coverage is weak (min ${featureCoverage.minKeys} axes; need ≥${minFeatureKeys} per option). Unattended autonomy is blocked.`,
    );
  }
  if (sensitivityUnstable) {
    parts.push(
      `Weight sensitivity unstable: ±${sensitivityEpsilon} swing on ${flippingPrincipleIds.length} principle(s) flips the winner. Do not auto-execute.`,
    );
  }
  if (autonomy.eligible) {
    parts.push(`Autonomy eligible: quality gates passed.`);
  }
  const reasoning = parts.join(" ");

  return {
    recommendation,
    scores,
    flags,
    reasoning,
  };
}

export function buildOptionScores(
  options: DecisionOption[],
  principles: DecisionPrinciple[],
): DecisionOptionScore[] {
  return options.map((option) => {
    const contributions: PrincipleContribution[] = principles.map((p) => {
      const useStructured = hasScoreableOverlap(option, p);
      const aln = useStructured
        ? computeStructuredAlignment(option, p)
        : computeSemanticAlignment(option, p);
      const contribution = p.weight * aln.alignment;
      const row: PrincipleContribution = {
        principleId: p.id,
        principleName: p.name,
        tier: p.tier,
        weight: p.weight,
        mode: aln.mode,
        alignment: aln.alignment,
        contribution,
      };
      if (aln.mode === "structured" && aln.missingDimensions.length > 0) {
        row.missingDimensions = aln.missingDimensions;
      }
      return row;
    });

    const composite = contributions.reduce((sum, c) => sum + c.contribution, 0);
    return { optionId: option.id, composite, contributions };
  });
}
