// Phase 2 Task 2.5 of the principles-as-wiki-kind plan: principle_decide
// core math. Pure module — no I/O, no logging side effects. The Phase 2
// Task 2.7 MCP handler is responsible for retrieving principles and
// embeddings, then calling these primitives.
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

// ─── Composite scoring + contribution ledger ────────────────────────────────

/**
 * For each option, compute the composite decision score across all
 * principles and return the contribution ledger.
 *
 * Selection of structured vs. semantic alignment is per-principle:
 * - If `principle.dimensionVector` has at least one entry → structured.
 * - Otherwise → semantic (uses both embeddings; zero if either is missing).
 *
 * Tasks 2.6 (guardrails: tie-margin, commandment-conflict, semantic-
 * fallback coverage) consume this output downstream.
 */
export function buildOptionScores(
  options: DecisionOption[],
  principles: DecisionPrinciple[],
): DecisionOptionScore[] {
  return options.map((option) => {
    const contributions: PrincipleContribution[] = principles.map((p) => {
      const useStructured = Object.keys(p.dimensionVector).length > 0;
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
