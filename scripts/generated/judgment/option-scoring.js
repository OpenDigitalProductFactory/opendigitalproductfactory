// Generated from packages/validators/src/judgment/option-scoring.ts by scripts/build-judgment-guard-runtime.mjs; do not edit.
// Phase 2 Task 2.5 of the principles-as-wiki-kind plan: principle_decide
// core math. Pure module — no I/O, no logging side effects. The Phase 2
// Task 2.7 MCP handler is responsible for retrieving principles and
// embeddings, then calling these primitives.
import { evaluateAutonomyEligibility, measureFeatureCoverage, } from "./mcda-quality-gates.js";
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
export function computeStructuredAlignment(option, principle) {
    const dims = Object.keys(principle.dimensionVector);
    if (dims.length === 0) {
        return { alignment: 0, mode: "structured", missingDimensions: [] };
    }
    let numerator = 0;
    let denominator = 0;
    const missingDimensions = [];
    for (const dim of dims) {
        const v = principle.dimensionVector[dim];
        const f = option.features[dim];
        denominator += Math.abs(v);
        if (typeof f === "number") {
            numerator += f * v;
        }
        else {
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
export function computeSemanticAlignment(option, principle) {
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
export function hasScoreableOverlap(option, principle) {
    const dims = Object.keys(principle.dimensionVector);
    if (dims.length === 0)
        return false;
    return dims.some((dim) => typeof option.features[dim] === "number");
}
/**
 * BI-2107B5D2: why a verdict is not `proceed`. A decline names its cause, because
 * a decline without a reason is indistinguishable from a failure to decide.
 */
export const DECISION_VERDICT_CAUSES = [
    "commandment-conflict",
    "all-options-opposed",
    "low-margin",
    "coverage-weak",
    "sensitivity-unstable",
];
/**
 * BI-2107B5D2: the three-band verdict. `proceed` and `decline` are both
 * assurances — each carries its own next step and costs no human turn.
 * `uncertain` is the only band where doubt lives, and the only one with a
 * retry edge.
 */
export const DECISION_VERDICTS = ["proceed", "uncertain", "decline"];
/**
 * BI-2107B5D2: decision stakes widen or narrow the uncertain band. A
 * high-consequence decision demands more separation before it will call
 * anything an assurance; a routine one demands less.
 */
export const DECISION_STAKES = ["routine", "elevated", "high"];
/**
 * BI-1BBB2136: parse a caller-supplied stakes value. An unrecognised value
 * yields undefined so the caller falls back to the default rather than failing
 * a governance consult over a typo.
 */
export function parseDecisionStakes(value) {
    return DECISION_STAKES.includes(String(value))
        ? value
        : undefined;
}
/** Multipliers applied to the base tie-margin to derive the upper band edge. */
export const STAKES_BAND_MULTIPLIER = {
    routine: 0.5,
    elevated: 1,
    high: 2,
};
const DEFAULT_TIE_MARGIN = 0.2;
const DEFAULT_SEMANTIC_FALLBACK_WARN_RATIO = 0.4;
const DEFAULT_COMMANDMENT_CONFLICT_THRESHOLD = 0.5;
const DEFAULT_MIN_FEATURE_KEYS = 3;
const DEFAULT_SENSITIVITY_EPSILON = 0.1;
/**
 * BI-2107B5D2: base lower edge. A winner whose composite sits at or below this
 * is opposed by the principles that applied — every option on the table is bad,
 * which is a confident NO, not a failure to choose.
 */
const DEFAULT_DECLINE_COMPOSITE = -0.2;
const DEFAULT_STAKES = "elevated";
/**
 * BI-2107B5D2: derive the band edges in force for one decision. Stakes scale
 * BOTH edges — a high-stakes call demands more separation to proceed and less
 * opposition to decline, so the uncertain band widens from both sides.
 */
export function resolveDecisionBands(tieMargin, stakes) {
    const multiplier = STAKES_BAND_MULTIPLIER[stakes];
    return {
        upper: tieMargin * multiplier,
        lower: DEFAULT_DECLINE_COMPOSITE / multiplier,
        stakes,
    };
}
/**
 * BI-2107B5D2: the three-band verdict, with its cause when it is not `proceed`.
 *
 * Ordering is deliberate and is the whole point of the split: a commandment
 * conflict is a DECLINE with a named reason, not an uncertainty. Collapsing it
 * into "low confidence" is what made a decisive no indistinguishable from a
 * coin-flip.
 */
export function resolveVerdict(input) {
    if (input.commandmentConflict) {
        return { verdict: "decline", verdictCause: "commandment-conflict" };
    }
    if (input.winnerComposite <= input.bands.lower) {
        return { verdict: "decline", verdictCause: "all-options-opposed" };
    }
    if (input.featureCoverageWeak) {
        return { verdict: "uncertain", verdictCause: "coverage-weak" };
    }
    if (input.sensitivityUnstable) {
        return { verdict: "uncertain", verdictCause: "sensitivity-unstable" };
    }
    if (input.margin < input.bands.upper) {
        return { verdict: "uncertain", verdictCause: "low-margin" };
    }
    return { verdict: "proceed", verdictCause: null };
}
/**
 * BI-2107B5D2: confidence in the VERDICT, computed from the real margin rather
 * than stamped as a constant. Confidence is how far inside its band the result
 * sits: an assurance deepens as it moves away from the edge, and an uncertain
 * result is weakest in the middle of the band.
 *
 * Ranges: assurances (proceed / decline) land in [0.5, 1]; uncertain lands in
 * [0, 0.5). The boundary is therefore meaningful — 0.5 is exactly the edge.
 */
/**
 * BI-2107B5D2: read the verdict off a recommendation, projecting legacy shapes.
 * A result persisted before the three bands existed carries only the boolean,
 * which can distinguish proceed from not-proceed but never a decline from an
 * uncertainty — so legacy rows project to `uncertain`, never to a false
 * assurance.
 */
export function readVerdict(recommendation, flags) {
    const bands = recommendation.bands ?? resolveDecisionBands(DEFAULT_TIE_MARGIN, DEFAULT_STAKES);
    if (recommendation.verdict) {
        return {
            verdict: recommendation.verdict,
            verdictCause: recommendation.verdictCause ?? null,
            bands,
        };
    }
    // Legacy shape. A commandment conflict outranks the boolean: a conflicted
    // result must NEVER project to an assurance to proceed just because the old
    // field said "high". Everything else that is not "high" projects to
    // `uncertain`, never to a decline we cannot evidence.
    if (flags?.commandmentConflict) {
        return { verdict: "decline", verdictCause: "commandment-conflict", bands };
    }
    return {
        verdict: recommendation.confidence === "high" ? "proceed" : "uncertain",
        verdictCause: recommendation.confidence === "high" ? null : "low-margin",
        bands,
    };
}
export function verdictConfidence(recommendation) {
    const { margin, composite } = recommendation;
    const { verdict, bands } = readVerdict(recommendation);
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
    // Saturating, never-clamping curve: depth/(1+depth) approaches 1 without ever
    // reaching it, so two decisions that differ in margin ALWAYS differ in score.
    // A hard clamp would collapse every decisive result onto 1.0 and rebuild the
    // exact constant-stamping problem this replaces.
    const deepen = (depth) => 0.5 + 0.5 * (depth / (1 + depth));
    if (verdict === "proceed") {
        const depth = bands.upper <= 0 ? margin : (margin - bands.upper) / bands.upper;
        return deepen(Math.max(0, depth));
    }
    if (verdict === "decline") {
        const span = Math.abs(bands.lower) || 1;
        const depth = (bands.lower - composite) / span;
        return deepen(Math.max(0, depth));
    }
    // Uncertain: rises toward the proceed edge but never reaches an assurance.
    const upper = bands.upper <= 0 ? 1 : bands.upper;
    return clamp(clamp(margin / upper, 0, 1) / 2, 0, 0.499);
}
/**
 * BI-2107B5D2: which uncertain causes can be retried with a changed input, and
 * what the caller must change. A retry that changes nothing returns the same
 * answer forever, so the cause dictates the input to move — never a bare re-run.
 */
export const VERDICT_RETRY_HINTS = {
    "commandment-conflict": null,
    "all-options-opposed": "Offer different options — every option on the table is opposed by the principles that applied.",
    "low-margin": "Separate the options: add discriminating features, or drop options that are near-duplicates of each other.",
    "coverage-weak": "Supply richer per-option feature maps — some options score too few axes to discriminate.",
    "sensitivity-unstable": "Stabilise the inputs: the winner flips under small weight swings, so the option set or the weights need firmer grounding.",
};
/**
 * Top-level advisory decision call. Wraps buildOptionScores with the
 * three guardrails from spec section 11.3 and a human-readable reasoning
 * string. Returns a `recommendation: null` shape when no principles
 * apply or no options are supplied so callers can surface "no signal"
 * to the user rather than picking arbitrarily.
 */
export function decide(options, principles, config = {}) {
    const tieMargin = config.tieMargin ?? DEFAULT_TIE_MARGIN;
    const bands = resolveDecisionBands(tieMargin, config.stakes ?? DEFAULT_STAKES);
    const semanticWarnRatio = config.semanticFallbackWarnRatio ?? DEFAULT_SEMANTIC_FALLBACK_WARN_RATIO;
    const commandmentConflictThreshold = config.commandmentConflictThreshold ??
        DEFAULT_COMMANDMENT_CONFLICT_THRESHOLD;
    const minFeatureKeys = config.minFeatureKeys ?? DEFAULT_MIN_FEATURE_KEYS;
    const sensitivityEpsilon = config.sensitivityEpsilon ?? DEFAULT_SENSITIVITY_EPSILON;
    const scores = buildOptionScores(options, principles);
    // No options or no principles → no signal; caller surfaces a "no
    // recommendation" message rather than picking arbitrarily.
    if (scores.length === 0 || principles.length === 0) {
        const flags = {
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
        const reasoning = principles.length === 0
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
    const hasAnySignal = scores.some((s) => s.contributions.some((c) => c.contribution !== 0));
    if (!hasAnySignal) {
        const flags = {
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
    // Coverage: ratio of semantic-mode contributions across all option × principle pairs.
    const totalContribs = scores.reduce((sum, s) => sum + s.contributions.length, 0);
    const semanticContribs = scores.reduce((sum, s) => sum + s.contributions.filter((c) => c.mode === "semantic").length, 0);
    const semanticFallbackRatio = totalContribs === 0 ? 0 : semanticContribs / totalContribs;
    const structuredCoverage = semanticFallbackRatio > semanticWarnRatio ? "weak" : "strong";
    // BI-1D23EC26: feature coverage (MCDA performance matrix completeness).
    const featureCoverage = measureFeatureCoverage(options, scores, minFeatureKeys);
    const featureCoverageWeak = featureCoverage.weak;
    // BI-1D23EC26: ±ε one-at-a-time principle weight sensitivity.
    let sensitivityUnstable = false;
    let flippingPrincipleIds = [];
    if (sensitivityEpsilon > 0) {
        const factors = [
            1 + sensitivityEpsilon,
            Math.max(0, 1 - sensitivityEpsilon),
        ];
        for (const p of principles) {
            let flipped = false;
            for (const factor of factors) {
                const perturbed = principles.map((q) => q.id === p.id ? { ...q, weight: q.weight * factor } : q);
                const alt = buildOptionScores(options, perturbed);
                if (alt.length === 0)
                    continue;
                const altWinner = [...alt].sort((a, b) => b.composite - a.composite)[0]
                    ?.optionId;
                if (altWinner && altWinner !== winner.optionId) {
                    flipped = true;
                    break;
                }
            }
            if (flipped)
                flippingPrincipleIds.push(p.id);
        }
        sensitivityUnstable = flippingPrincipleIds.length > 0;
    }
    // Commandment conflict against the top option.
    const conflictingPrinciples = winner.contributions
        .filter((c) => c.tier === "commandment" &&
        c.contribution < -commandmentConflictThreshold)
        .map((c) => c.principleId);
    // BI-2107B5D2: the three-band verdict. `confidence` stays as the
    // back-compatible projection — "high" iff the verdict is `proceed`.
    const { verdict, verdictCause } = resolveVerdict({
        margin,
        winnerComposite: winner.composite,
        bands,
        commandmentConflict: conflictingPrinciples.length > 0,
        featureCoverageWeak,
        sensitivityUnstable,
    });
    // Single derivation. Coverage-weak and sensitivity-unstable used to force
    // "low" here in their own pass; resolveVerdict now returns `uncertain` for
    // both, so the projection below carries them. Two derivations of one field in
    // one function is how the two drift apart later.
    const confidence = verdict === "proceed" ? "high" : "low";
    const recommendation = {
        optionId: winner.optionId,
        composite: winner.composite,
        margin,
        confidence,
        verdict,
        verdictCause,
        bands,
    };
    const provisionalFlags = {
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
    const flags = {
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
    const parts = [];
    parts.push(`Recommends ${winner.optionId} (composite ${winner.composite.toFixed(3)}, margin ${margin.toFixed(3)}).`);
    if (topContribs.length > 0) {
        parts.push(`Strongest contributors: ${topContribs.join(", ")}.`);
    }
    if (confidence === "low") {
        parts.push(`Margin is below tieMargin (${tieMargin}) or MCDA quality gates failed — recommend owner review before committing.`);
    }
    if (flags.commandmentConflict) {
        parts.push(`Commandment conflict: ${conflictingPrinciples.join(", ")} oppose the recommended option. Re-check whether the tension is intentional.`);
    }
    if (flags.structuredCoverage === "weak") {
        parts.push(`Structured coverage is weak (${Math.round(semanticFallbackRatio * 100)}% semantic fallback). Consider supplying explicit dimension features on the options.`);
    }
    if (featureCoverageWeak) {
        parts.push(`Feature coverage is weak (min ${featureCoverage.minKeys} axes; need ≥${minFeatureKeys} per option). Unattended autonomy is blocked.`);
    }
    if (sensitivityUnstable) {
        parts.push(`Weight sensitivity unstable: ±${sensitivityEpsilon} swing on ${flippingPrincipleIds.length} principle(s) flips the winner. Do not auto-execute.`);
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
export function buildOptionScores(options, principles) {
    return options.map((option) => {
        const contributions = principles.map((p) => {
            const useStructured = hasScoreableOverlap(option, p);
            const aln = useStructured
                ? computeStructuredAlignment(option, p)
                : computeSemanticAlignment(option, p);
            const contribution = p.weight * aln.alignment;
            const row = {
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
