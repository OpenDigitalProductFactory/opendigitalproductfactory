// EP-0AF96937 Phase 2 completion: a readable projection of the decision matrix.
//
// Every principle is scored against a fixed registry of dimensions (the axes)
// with per-tier default weights. That registry IS the "matrix" the operator
// wants to revisit / de-conflict / analyze over time. This module is pure — it
// projects the closed registry from `@dpf/db/wiki-taxonomy` into a labeled,
// human-readable model. Adding or reweighting an axis remains a governed
// schema/registry change (a PR), so this view is read-only by design; the page
// layers live per-axis principle counts on top.

import {
  PRINCIPLE_DIMENSIONS,
  PRINCIPLE_COST_DIMENSIONS,
  PRINCIPLE_TIER_DEFAULT_WEIGHT,
  PRINCIPLE_TIERS,
  type PrincipleDimension,
} from "@dpf/db/wiki-taxonomy";

export type MatrixDimension = {
  key: PrincipleDimension;
  label: string;
  /** "benefit" — more is better; "cost" — more is worse (weighted negative). */
  kind: "benefit" | "cost";
};

export type MatrixTierWeight = {
  tier: string;
  label: string;
  weight: number;
};

const TIER_LABEL: Record<string, string> = {
  commandment: "Commandment",
  core: "Core",
  contextual: "Contextual",
};

/** Humanize a snake_case dimension key: "long_term_maintainability" → "Long term maintainability". */
export function humanizeDimension(key: string): string {
  const words = key.split("_").filter(Boolean);
  if (words.length === 0) return key;
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const COST_SET = new Set<string>(PRINCIPLE_COST_DIMENSIONS);

/** Project the dimension registry into labeled benefit/cost rows, costs last. */
export function buildMatrixDimensions(): MatrixDimension[] {
  const rows: MatrixDimension[] = PRINCIPLE_DIMENSIONS.map((key) => ({
    key,
    label: humanizeDimension(key),
    kind: COST_SET.has(key) ? ("cost" as const) : ("benefit" as const),
  }));
  // Benefits first, then costs; stable alpha within each group by label.
  return rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "benefit" ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

/** Project the per-tier default weights, in commandment → core → contextual order. */
export function buildMatrixTierWeights(): MatrixTierWeight[] {
  return PRINCIPLE_TIERS.map((tier) => ({
    tier,
    label: TIER_LABEL[tier] ?? tier,
    weight: PRINCIPLE_TIER_DEFAULT_WEIGHT[tier],
  }));
}
