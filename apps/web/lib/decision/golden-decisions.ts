// Corpus-aware golden-decision baseline.
//
// Purpose (operator-stated): the founder kernel is a living corpus. Every new
// or edited principle, and every new dimension, shifts the weighted-vector
// aggregate. We need to know — deterministically, at the engine level — when a
// corpus change *flips a canonical decision* (a "broken baseline"), so we can
// decide whether to revisit a dimension or the principle aggregate.
//
// This module is PURE: it takes already-parsed principle pages (loaded from the
// real docs/founder-kernel/wiki/principles/*.md by the test via the canonical
// @dpf/db `parseWikiFrontmatter`) and a scenario panel, and scores each
// scenario through the SAME `decide()` engine the principle_decide MCP handler
// uses. The test layer owns fs + snapshot comparison.
//
// Spec: docs/superpowers/specs/2026-06-05-situational-aware-decision-weighting-design.md
// Companion: situational-weighting.backtest.test.ts (frozen-ledger controlled
// A/B — proves the mechanism; this file tracks corpus drift).

import { decide, type DecisionOption, type DecisionPrinciple, type DecisionResult } from "./option-scoring";

// ─── Parsed-page shape (subset of WikiPage frontmatter we score against) ─────
export type ParsedPrinciplePage = {
  slug: string;
  principleTier?: string;
  principleAppliesTo?: string[];
  principleDimensionVector?: Record<string, number>;
  principleWeight?: number;
};

const TIER_DEFAULT_WEIGHT: Record<string, number> = {
  commandment: 1.0,
  core: 0.4,
  contextual: 0.1,
};

/**
 * Select the principle set a UNIVERSAL-RING caller actually scores against,
 * mirroring the live `principle_decide` retrieval:
 *
 * - Only `commandment` tier contributes structured signal today: commandments
 *   load from Postgres WITH their signed vector, while core/contextual load
 *   from Qdrant WITHOUT it and fall to semantic alignment (which is 0 in the
 *   structured-decision sense). So a faithful engine baseline scores
 *   commandments only. When Layer 2 makes core/contextual carry their vectors,
 *   widen this filter and regenerate the baseline.
 * - A universal-ring caller consults the FULL kernel: NO ring filtering. Only
 *   the population filter applies (`principleAppliesTo` contains the caller
 *   population, or is empty for backward-compat).
 * - Weight = `principleWeight` override ?? tier default.
 *
 * There is intentionally no `limit` — the commandment retrieval cap was raised
 * to 50 so all commandments are consulted; this baseline scores all of them.
 */
export function selectKernelCommandments(
  pages: ParsedPrinciplePage[],
  population = "in_platform_coworker",
): DecisionPrinciple[] {
  return pages
    .filter((p) => p.principleTier === "commandment")
    .filter((p) => !p.principleAppliesTo?.length || p.principleAppliesTo.includes(population))
    .map((p) => ({
      id: p.slug,
      name: p.slug,
      tier: "commandment",
      weight: typeof p.principleWeight === "number" ? p.principleWeight : TIER_DEFAULT_WEIGHT.commandment,
      dimensionVector: p.principleDimensionVector ?? {},
    }))
    .sort((a, b) => a.id.localeCompare(b.id)); // stable order for reproducible snapshots
}

// ─── The canonical scenario panel ────────────────────────────────────────────
// Each scenario is a founder-curated decision whose outcome is doctrine. The
// panel is meant to GROW — add a scenario whenever a decision class matters
// enough that a silent flip would be a bug. `marginFloor` guards against a
// canonical call degenerating into a coin-flip even if the winner holds.
export type GoldenScenario = {
  id: string;
  rationale: string;
  options: DecisionOption[];
  expectedWinner: string;
  marginFloor: number;
};

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  {
    id: "quick-vs-proper-normal",
    rationale:
      "Normal development, no incident. A genuine shortcut (parallel runtime code path) vs the proper seed fix. The kernel must prefer the proper fix.",
    expectedWinner: "proper-seed-fix",
    marginFloor: 0.3,
    options: [
      {
        id: "quick-runtime-patch",
        description: "Runtime special-case branch — fast, tiny diff, passes gates, but adds a parallel code path (debt).",
        features: { long_term_maintainability: 0.2, schema_grounding: 0.2, reusability: 0.2, blast_radius: 0.1, speed_to_value: 0.9, evidence_density: 0.85, governance_compliance: 0.85, public_safety: 0.5, human_cognitive_load: 0.3 },
      },
      {
        id: "proper-seed-fix",
        description: "Patch the seed so every install is correct — sound, removes the special case, slower, wider blast.",
        features: { long_term_maintainability: 0.95, schema_grounding: 0.85, reusability: 0.7, blast_radius: 0.55, speed_to_value: 0.15, evidence_density: 0.5, governance_compliance: 0.5, human_cognitive_load: 0.4 },
      },
    ],
  },
  {
    id: "cheap-sound-vs-rebuild-guard",
    rationale:
      "Anti-maximalism guard. A cheap, sound, additive fix vs an expensive maximalist rebuild — NEITHER is a shortcut. The kernel must NOT prefer the bigger/slower option just because it is marginally more maintainable. If this flips, the corpus has tilted toward maximalism — revisit the cost dimension (Layer 2), not the weights.",
    expectedWinner: "cheap-sound-additive",
    marginFloor: 0.1,
    options: [
      {
        id: "cheap-sound-additive",
        description: "Small additive observability hook — sound, low blast, fast, cost-effective, no debt.",
        features: { long_term_maintainability: 0.85, schema_grounding: 0.8, reusability: 0.6, blast_radius: 0.2, speed_to_value: 0.75, evidence_density: 0.9, governance_compliance: 0.6, cost_efficiency: 0.9, human_cognitive_load: 0.3 },
      },
      {
        id: "expensive-rebuild",
        description: "Full telemetry rebuild — marginally more maintainable but huge blast, slow, costly.",
        features: { long_term_maintainability: 0.9, schema_grounding: 0.85, reusability: 0.7, blast_radius: 0.95, speed_to_value: 0.05, evidence_density: 0.4, governance_compliance: 0.5, cost_efficiency: 0.2, human_cognitive_load: 0.1 },
      },
    ],
  },
];

// ─── Scoring + snapshot shape ────────────────────────────────────────────────
export type ScenarioSnapshot = {
  id: string;
  winner: string;
  margin: number;
  confidence: string;
  /** commandment count consulted — drifts when the corpus grows. */
  principlesConsidered: number;
  composites: Record<string, number>;
  /** Top contributors to the winner, for human review of WHY a decision holds/flips. */
  topContributors: Array<{ principle: string; contribution: number }>;
};

export function scoreScenario(scenario: GoldenScenario, principles: DecisionPrinciple[]): { result: DecisionResult; snapshot: ScenarioSnapshot } {
  const result = decide(scenario.options, principles);
  const winnerScore = result.scores.find((s) => s.optionId === result.recommendation?.optionId);
  const composites: Record<string, number> = {};
  for (const s of result.scores) composites[s.optionId] = round(s.composite);
  const topContributors = (winnerScore?.contributions ?? [])
    .filter((c) => Math.abs(c.contribution) > 1e-6)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5)
    .map((c) => ({ principle: c.principleName, contribution: round(c.contribution) }));
  return {
    result,
    snapshot: {
      id: scenario.id,
      winner: result.recommendation?.optionId ?? "(none)",
      margin: round(result.recommendation?.margin ?? 0),
      confidence: result.recommendation?.confidence ?? "low",
      principlesConsidered: principles.length,
      composites,
      topContributors,
    },
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
