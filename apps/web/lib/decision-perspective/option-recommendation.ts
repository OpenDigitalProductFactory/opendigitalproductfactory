// BI-D88DFEEA Phase 1 — score a gate's closed option menu against kernel
// commandments to derive a `recommendedOptionId`, the missing half of the
// weight-inference adapter's WeightInferenceObservation contract (spec
// docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-
// epistemology-design.md §2.4).
//
// Deliberately commandments-only, not a full principle_decide call. The full
// retrieval path (apps/web/lib/mcp/packs/principle-decide-pack.ts) carries
// Qdrant core/contextual search, ring-scope filtering, and the RC2/RC3/RC6
// fixes shipped 2026-07-24 (BI-E1267C6D) — reusing or duplicating that
// machinery here would touch the single most recently-fixed, most sensitive
// retrieval path in the platform for a gate-verdict decision that commandments
// (universal, always-applied, structurally signed-vector doctrine) already
// answer honestly. This module reuses two already-tested primitives —
// `listPrinciplesByTier` (@dpf/db) and `decide()` (option-scoring.ts) — and
// adds no new scoring math.

import { listPrinciplesByTier } from "@dpf/db/wiki-store";
import { decide, type DecisionOption, type DecisionPrinciple } from "../decision/option-scoring";
import type { DecisionScoredOption } from "./types";

const TIER_DEFAULT_WEIGHT = 1.0; // commandments only; matches principle-decide-pack.ts's TIER_DEFAULT_WEIGHT.commandment.

type CommandmentClient = Parameters<typeof listPrinciplesByTier>[0];

/**
 * Score a gate's scored options against kernel commandments and return the
 * argmax option id, or null when there is nothing to recommend (no scored
 * options, no commandments returned, or decide() reports insufficient
 * signal). Never throws on a retrieval failure — a gate's core verdict
 * (recommend/escalate/arbitrate/defer) must not depend on this succeeding.
 */
export async function recommendOptionAgainstCommandments(input: {
  db: CommandmentClient;
  scoredOptions: DecisionScoredOption[];
  organizationId?: string | null;
}): Promise<string | null> {
  if (input.scoredOptions.length === 0) return null;

  let rows: unknown[];
  try {
    rows = await listPrinciplesByTier(input.db, {
      tier: "commandment",
      organizationId: input.organizationId ?? null,
      appliesTo: "human",
      limit: 50,
    });
  } catch (err) {
    console.warn("[option-recommendation] commandment lookup failed:", err);
    return null;
  }

  const principles: DecisionPrinciple[] = (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row["id"] ?? ""),
    name: String(row["title"] ?? row["slug"] ?? "principle"),
    tier: String(row["principleTier"] ?? "commandment"),
    weight: typeof row["principleWeight"] === "number" ? (row["principleWeight"] as number) : TIER_DEFAULT_WEIGHT,
    dimensionVector: (row["principleDimensionVector"] as Record<string, number> | null) ?? {},
  }));

  const options: DecisionOption[] = input.scoredOptions.map((o) => ({
    id: o.id,
    description: o.description,
    features: o.features,
  }));

  const result = decide(options, principles);
  return result.recommendation?.optionId ?? null;
}
