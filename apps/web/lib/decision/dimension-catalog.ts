// Caller-facing catalogue for the principle_decide option-feature axes
// (BI-E0151DB2). The registry itself lives in packages/db/src/wiki-taxonomy.ts;
// this module is what makes it USABLE from outside the repo.
//
// THE DEFECT THIS CLOSES
// `principle_decide` scored 165 consults with a 16.7% insufficient-signal rate
// because its `features` parameter was documented as:
//
//   "Optional map of dimension key -> 0..1 score. Dimensions must come from the
//    registry in packages/db/src/wiki-taxonomy.ts."
//
// Three things were wrong with that, and each one is a silent failure:
//
//   1. `features` is NOT optional in practice. Commandments are loaded from
//      Postgres with a full principleDimensionVector, so
//      computeStructuredAlignment always takes the structured branch
//      (option-scoring.ts:85-88) and the semantic fallback never fires for
//      them. With no features the numerator is 0 for every principle, so every
//      contribution is exactly zero.
//   2. The valid key set was named by FILE PATH. An in-platform coworker cannot
//      read repo source, so for that population the registry was unreachable.
//   3. The sign convention was never surfaced. Four axes are COSTS: a feature
//      answers "how much does this option EXHIBIT this axis", and the opposing
//      principle carries a NEGATIVE weight, so a higher score is WORSE. Scoring
//      an option 0.9 on blast_radius because it is "safe" inverts the meaning
//      and penalises the option the author was arguing for.
//
// A fourth, unreported failure: computeStructuredAlignment iterates the
// PRINCIPLE's dimensions and reads option.features[dim], so a feature key that
// is not a real dimension is never read. A typo was silently worth zero.
//
// Consistency is the point. This same tool already fails fast on an unknown
// `ringScope` value, citing `make-silent-failures-observable`. Feature keys now
// get the identical treatment.

import {
  PRINCIPLE_DIMENSIONS,
  PRINCIPLE_COST_DIMENSIONS,
  type PrincipleDimension,
} from "@dpf/db/wiki-taxonomy";

export type DimensionKind = "benefit" | "cost";

export type DimensionGuidance = {
  key: PrincipleDimension;
  kind: DimensionKind;
  /** What a HIGH (near 1.0) score asserts about the option. */
  highMeans: string;
};

const COST_SET = new Set<string>(PRINCIPLE_COST_DIMENSIONS);

/**
 * What a high score asserts, per axis. Phrased as "how much the option exhibits
 * this axis" — never as "good/bad" — because that framing is exactly what
 * callers get wrong on the cost axes.
 */
const HIGH_MEANS: Record<PrincipleDimension, string> = {
  long_term_maintainability:
    "the option is durable and cheap to keep correct as the system grows",
  blast_radius:
    "the option reaches MORE of the estate and breaks more if it is wrong",
  reusability: "the option is reusable across more callers and contexts",
  evidence_density:
    "the option is backed by more verifiable evidence rather than assertion",
  human_cognitive_load:
    "the option demands MORE human attention, judgement, or explanation",
  capacity_utilization: "the option makes fuller use of available capacity",
  governance_compliance:
    "the option satisfies more governance, policy, and audit obligations",
  public_safety: "the option better protects people outside the organization",
  speed_to_value: "the option delivers usable value sooner",
  schema_grounding:
    "the option is anchored in the existing schema and substrate rather than new structure",
  operational_independence:
    "the option keeps the platform able to run without external dependencies",
  data_privacy: "the option better protects personal and sensitive data",
  cost_efficiency: "the option achieves the outcome for less money",
  vendor_lock_in:
    "the option ties the platform MORE tightly to a single external vendor",
  reversibility: "the option is easier to undo after the fact",
  evidence_confidence: "the investigation behind the option is more conclusive",
  customer_consent_state:
    "the option is covered by broader standing customer approval",
  business_disruption:
    "the option interrupts MORE of live business operation while it is applied",
  operator_effort:
    "the option demands MORE operator operations and elapsed time to reach the outcome",
  legibility_of_consequence:
    "the operator can better foresee, before authorizing, what the option will do, to what, under whose authority, and how it is undone",
};

/** The full caller-facing catalogue, benefits first then costs, stable order. */
export const DIMENSION_CATALOG: readonly DimensionGuidance[] = PRINCIPLE_DIMENSIONS.map(
  (key): DimensionGuidance => ({
    key,
    kind: COST_SET.has(key) ? "cost" : "benefit",
    highMeans: HIGH_MEANS[key],
  }),
)
  .slice()
  .sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "benefit" ? -1 : 1;
    return a.key.localeCompare(b.key);
  });

export const DIMENSION_KEYS: readonly string[] = PRINCIPLE_DIMENSIONS;

/**
 * The `features` schema description, generated from the catalogue so the tool
 * surface can never drift from the registry. A new dimension added to
 * PRINCIPLE_DIMENSIONS appears here automatically — and the catalogue-coverage
 * test fails until it is given guidance.
 */
export function buildFeaturesDescription(): string {
  const costs = DIMENSION_CATALOG.filter((d) => d.kind === "cost");
  const benefits = DIMENSION_CATALOG.filter((d) => d.kind === "benefit");
  const line = (d: DimensionGuidance) => `${d.key} — high means ${d.highMeans}`;
  return [
    "REQUIRED IN PRACTICE, despite being schema-optional: governance commandments are",
    "loaded with full dimension vectors, so scoring takes the structured path and an",
    "option with no features scores exactly 0 against every principle. Omitting this",
    "yields insufficientSignal=true and recommendation=null, NOT a neutral result.",
    "",
    "Each value is 0..1 and answers ONE question: how much does this option EXHIBIT",
    "this axis? It is NOT a goodness rating. Unknown keys are rejected.",
    "",
    `BENEFIT axes (higher = more of a good thing): ${benefits.map(line).join("; ")}.`,
    "",
    `COST axes — HIGHER IS WORSE. The governing principle carries a negative weight,`,
    `so a high score PENALISES the option. Score the magnitude, never the goodness:`,
    `${costs.map(line).join("; ")}.`,
    "",
    "Score every axis you can judge; partial coverage is reported per principle in",
    "the contribution ledger as missingDimensions.",
  ].join(" ");
}

export type FeatureValidationError = {
  optionId: string;
  key: string;
  problem: "unknown-dimension" | "out-of-range" | "not-a-number";
  detail: string;
};

/** Nearest known dimension for a typo, by simple containment then prefix. */
function suggestFor(key: string): string | null {
  const lower = key.toLowerCase();
  const hit =
    DIMENSION_KEYS.find((d) => d === lower) ??
    DIMENSION_KEYS.find((d) => d.includes(lower) || lower.includes(d)) ??
    DIMENSION_KEYS.find((d) => d.split("_")[0] === lower.split("_")[0]);
  return hit ?? null;
}

/**
 * Validate one option's feature map. Unknown keys and out-of-range values are
 * REJECTED rather than ignored — a key that is not a real dimension is never
 * read by computeStructuredAlignment, so tolerating it means a typo silently
 * scores zero. Mirrors the existing fail-fast treatment of `ringScope`.
 */
export function validateOptionFeatures(
  optionId: string,
  features: Record<string, unknown>,
): FeatureValidationError[] {
  const errors: FeatureValidationError[] = [];
  const known = new Set<string>(DIMENSION_KEYS);
  for (const [key, raw] of Object.entries(features)) {
    if (!known.has(key)) {
      const suggestion = suggestFor(key);
      errors.push({
        optionId,
        key,
        problem: "unknown-dimension",
        detail:
          `"${key}" is not a principle dimension, so it would never be read` +
          (suggestion ? `. Did you mean "${suggestion}"?` : "."),
      });
      continue;
    }
    if (typeof raw !== "number" || Number.isNaN(raw)) {
      errors.push({
        optionId,
        key,
        problem: "not-a-number",
        detail: `"${key}" must be a number in 0..1, received ${JSON.stringify(raw)}.`,
      });
      continue;
    }
    if (raw < 0 || raw > 1) {
      errors.push({
        optionId,
        key,
        problem: "out-of-range",
        detail: `"${key}" must be within 0..1, received ${raw}.`,
      });
    }
  }
  return errors;
}

/** Human-readable remediation appended to a rejection message. */
export function featureErrorRemedy(): string {
  const costs = DIMENSION_CATALOG.filter((d) => d.kind === "cost").map((d) => d.key);
  return (
    `Valid dimensions: ${DIMENSION_KEYS.join(", ")}. ` +
    `Cost axes (higher = worse, score the magnitude not the goodness): ${costs.join(", ")}.`
  );
}
