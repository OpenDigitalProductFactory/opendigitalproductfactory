// BI-D88DFEEA Phase 2 — the DecisionInteraction adapter.
//
// Spec: docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-
// epistemology-design.md §2.4. Plan: docs/superpowers/plans/2026-07-24-
// weight-inference-from-rulings.md.
//
// Extracts WeightInferenceObservation[] (weight-inference.ts) from real
// DecisionInteraction rows. The original plan for this phase was per-path
// `humanOutcome` archaeology (≥5 distinct shapes across the escalation,
// org-decision, and work-pattern capture paths). BI-D88DFEEA Phase 1 (this
// same effort, 2026-07-24) made that archaeology unnecessary for the two
// gates it instrumented (build-studio-gate.ts, work-pattern-review.ts):
// those rows now carry `scoredOptions` (the DecisionOption[] actually
// scored), `recommendedOptionId` (the kernel's argmax via decide()), and
// `chosenOptionId` (the human's actual pick) directly on the row. A row from
// any OTHER capture path (org-business-gate, profession-gate, or an
// escalation/deferral capture whose form has not been redesigned to record a
// structured choice) simply has all three columns null — excluded by the
// query below, not silently misread. This is a stricter, simpler contract
// than parsing `humanOutcome`'s five prose shapes, and the reason Phase 1
// instrumented the gates first instead of Phase 2 doing textual archaeology.

import type { WeightInferenceObservation } from "./weight-inference";

type ScoredOptionRow = { id: string; description: string; features: Record<string, number> };

export type ExtractionFailure = {
  interactionId: string;
  /** Always one of a small closed set — never free text derived from row content. */
  reason:
    | "recommendedOptionId-not-in-scoredOptions"
    | "chosenOptionId-not-in-scoredOptions"
    | "scoredOptions-malformed";
};

export type ExtractionResult = {
  observations: WeightInferenceObservation[];
  /** Rows that carried scoredOptions/recommendedOptionId/chosenOptionId but
   *  could not be turned into an observation — surfaced, never dropped
   *  silently, per weight-inference.ts's own header comment. */
  failures: ExtractionFailure[];
};

type DecisionInteractionRow = {
  interactionId: string;
  domainClass: string;
  profileId: string;
  scoredOptions: unknown;
  recommendedOptionId: string | null;
  chosenOptionId: string | null;
};

type ExtractionClient = {
  decisionInteraction: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
      take?: number;
    }): Promise<DecisionInteractionRow[]>;
  };
};

function isScoredOptionRow(value: unknown): value is ScoredOptionRow {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string"
    && typeof v["description"] === "string"
    && typeof v["features"] === "object"
    && v["features"] !== null
  );
}

function parseScoredOptions(value: unknown): ScoredOptionRow[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every(isScoredOptionRow)) return null;
  return value as ScoredOptionRow[];
}

/**
 * Extract observations from every DecisionInteraction row that carries the
 * Phase 1 scoring columns. Never throws on a single row's malformed data —
 * that row is reported in `failures` and extraction continues, matching
 * `inferWeightProposals`'s own philosophy of never mutating and always
 * surfacing rather than crashing the whole run over one bad row.
 */
export async function extractWeightInferenceObservations(input: {
  db: ExtractionClient;
  domainClass?: string;
  profileId?: string;
  limit?: number;
}): Promise<ExtractionResult> {
  const where: Record<string, unknown> = {
    scoredOptions: { not: null },
    recommendedOptionId: { not: null },
    chosenOptionId: { not: null },
  };
  if (input.domainClass) where.domainClass = input.domainClass;
  if (input.profileId) where.profileId = input.profileId;

  const rows = await input.db.decisionInteraction.findMany({
    where,
    select: {
      interactionId: true,
      domainClass: true,
      profileId: true,
      scoredOptions: true,
      recommendedOptionId: true,
      chosenOptionId: true,
    },
    take: input.limit,
  });

  const observations: WeightInferenceObservation[] = [];
  const failures: ExtractionFailure[] = [];

  for (const row of rows) {
    const scoredOptions = parseScoredOptions(row.scoredOptions);
    if (!scoredOptions) {
      failures.push({ interactionId: row.interactionId, reason: "scoredOptions-malformed" });
      continue;
    }

    const recommended = scoredOptions.find((o) => o.id === row.recommendedOptionId);
    if (!recommended) {
      failures.push({ interactionId: row.interactionId, reason: "recommendedOptionId-not-in-scoredOptions" });
      continue;
    }

    const chosen = scoredOptions.find((o) => o.id === row.chosenOptionId);
    if (!chosen) {
      failures.push({ interactionId: row.interactionId, reason: "chosenOptionId-not-in-scoredOptions" });
      continue;
    }

    observations.push({
      domainClass: row.domainClass,
      profileId: row.profileId,
      chosenVector: chosen.features,
      recommendedVector: recommended.features,
    });
  }

  return { observations, failures };
}
