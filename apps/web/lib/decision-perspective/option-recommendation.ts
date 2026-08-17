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
import { projectLocalAxisVector } from "@dpf/db/profession-local-axes";
import { decide, type DecisionOption, type DecisionPrinciple } from "../decision/option-scoring";
import type { DecisionScoredOption } from "./types";

const TIER_DEFAULT_WEIGHT = 1.0; // commandments only; matches principle-decide-pack.ts's TIER_DEFAULT_WEIGHT.commandment.

type CommandmentClient = Parameters<typeof listPrinciplesByTier>[0];

/**
 * Phase 3 of the profession-local-axes plan (BI-106C2585, W16 wiring): when a
 * profession is in scope and an option scored NAMESPACED local-axis keys
 * (`<profession>/<axis>` — a bare key is unambiguously spine), roll them onto
 * the spine via `projectLocalAxisVector` before commandment scoring. Without
 * this, a local axis was silently ignored here — `computeStructuredAlignment`
 * only reads dimensions the principle's vector declares, and principle vectors
 * are spine-only — so profession-local features were inert in every gate
 * recommendation. Profession-gate path only: the WWMD principle_decide
 * retrieval path is untouched.
 */
function projectOptionFeaturesForProfession(
  professionKey: string | null | undefined,
  options: DecisionScoredOption[],
): DecisionScoredOption[] {
  if (!professionKey) return options;
  return options.map((option) => {
    const hasNamespacedKey = Object.keys(option.features).some((key) => key.includes("/"));
    if (!hasNamespacedKey) return option;
    return {
      ...option,
      features: projectLocalAxisVector(professionKey, option.features),
    };
  });
}

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
  /** When set, namespaced local-axis features project onto the spine (Phase 3). */
  professionKey?: string | null;
}): Promise<string | null> {
  if (input.scoredOptions.length === 0) return null;
  const scoredOptions = projectOptionFeaturesForProfession(
    input.professionKey,
    input.scoredOptions,
  );

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

  const options: DecisionOption[] = scoredOptions.map((o) => ({
    id: o.id,
    description: o.description,
    features: o.features,
  }));

  const result = decide(options, principles);
  return result.recommendation?.optionId ?? null;
}

/**
 * Gate-level wrapper around {@link recommendOptionAgainstCommandments} that
 * applies the shared "only recommend when it means something" guard: a
 * recommendation is only recorded when the gate actually supplied scored
 * options AND the verdict is a path forward (`recommend`/`arbitrate`). An
 * `escalate`/`defer` verdict means the kernel explicitly declined to pick among
 * the options, so recording a recommendation there would misrepresent what
 * happened. Returns `null` in every other case.
 *
 * Extracted from `evaluatePerspectiveGate` (BI-D88DFEEA) so the two gates that
 * write their own DecisionInteraction row — the async wrapper and
 * `profession-gate` — share one argmax implementation instead of hand-rolling
 * the guard twice (BI-6DCF772F).
 */
export async function resolveRecommendedOptionId(input: {
  db: CommandmentClient;
  scoredOptions?: DecisionScoredOption[] | null;
  organizationId?: string | null;
  outcomeType: string;
  /**
   * Profession in scope for local-axis projection (Phase 3, BI-106C2585).
   * Threaded only by the profession-gate path; WWMD/WWWD callers omit it and
   * behave exactly as before.
   */
  professionKey?: string | null;
}): Promise<string | null> {
  if (
    input.scoredOptions
    && input.scoredOptions.length > 0
    && (input.outcomeType === "recommend" || input.outcomeType === "arbitrate")
  ) {
    return recommendOptionAgainstCommandments({
      db: input.db,
      scoredOptions: input.scoredOptions,
      organizationId: input.organizationId ?? null,
      professionKey: input.professionKey ?? null,
    });
  }
  return null;
}

/** Apply shared scoring, then honor a hard-veto option without averaging it. */
export async function resolveGateRecommendedOptionId(input: {
  db: CommandmentClient;
  scoredOptions?: DecisionScoredOption[] | null;
  organizationId?: string | null;
  outcomeType: string;
  constitutionalVerdict?: "approve" | "decline" | "escalate";
}): Promise<string | null> {
  const scored = await resolveRecommendedOptionId(input);
  if (input.constitutionalVerdict !== "decline" || !input.scoredOptions?.length) {
    return scored;
  }
  return input.scoredOptions.find((option) =>
    /\b(decline|block|do not proceed|reject)\b/i.test(option.description),
  )?.id ?? scored;
}
