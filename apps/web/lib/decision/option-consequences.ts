// What each option would actually cost (BI-6700AF66, EP-0AF96937).
//
// The decision record renders options as bare ids — "Proceed", "Decline" — so
// the owner is asked to rule with the consequences withheld. When the gate
// scored real per-option feature vectors, those vectors already say how the
// options differ. This module turns that into one plain line per option.
//
// The rule that governs every branch here: NO FABRICATION. An option whose row
// was never scored, or whose features do not separate it from the alternatives,
// gets nothing back. Silence is correct; an invented consequence is not.
//
// Sign convention matters and is easy to get backwards: on a cost axis a HIGH
// score means the option exhibits MORE of that cost. The catalogue owns those
// phrasings (dimension-catalog.ts), so this module never re-words an axis.
//
// Spec: docs/superpowers/specs/2026-08-23-decision-concierge-design.md §4.2

import { DIMENSION_CATALOG, type DimensionGuidance } from "./dimension-catalog";

/** One scored option, as `DecisionInteraction.scoredOptions` records it. */
export type ScoredOptionInput = {
  id: string;
  description?: string | null;
  features?: Record<string, number> | null;
};

export type OptionConsequence = {
  optionId: string;
  /** Where this option is strongest, relative to the alternatives. */
  strengths: string[];
  /** What this option costs more than the alternatives. */
  costs: string[];
};

/** An axis only counts as distinguishing at this much separation from the field. */
const SEPARATION_FLOOR = 0.15;

/** At most this many lines per side, so the card stays readable. */
const MAX_PER_SIDE = 2;

const GUIDANCE_BY_KEY = new Map<string, DimensionGuidance>(
  DIMENSION_CATALOG.map((entry) => [entry.key as string, entry]),
);

/** Read the scoredOptions JSON defensively. Anything malformed is dropped. */
export function parseScoredOptions(value: unknown): ScoredOptionInput[] {
  if (!Array.isArray(value)) return [];
  const parsed: ScoredOptionInput[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.length === 0) continue;
    const rawFeatures = record.features;
    let features: Record<string, number> | null = null;
    if (rawFeatures && typeof rawFeatures === "object" && !Array.isArray(rawFeatures)) {
      features = {};
      for (const [key, val] of Object.entries(rawFeatures as Record<string, unknown>)) {
        if (typeof val === "number" && Number.isFinite(val)) features[key] = val;
      }
      if (Object.keys(features).length === 0) features = null;
    }
    parsed.push({
      id: record.id,
      description: typeof record.description === "string" ? record.description : null,
      features,
    });
  }
  return parsed;
}

/** Mean of an axis across every option that scored it. */
function fieldMean(options: ScoredOptionInput[], axis: string): number | null {
  const values = options
    .map((o) => o.features?.[axis])
    .filter((v): v is number => typeof v === "number");
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Per-option consequence lines, derived only from axes where the option
 * genuinely separates from the rest of the field. Returns an empty array when
 * fewer than two options were scored — with nothing to compare against, no
 * statement about relative cost is defensible.
 */
export function buildOptionConsequences(
  scoredOptions: ScoredOptionInput[],
): OptionConsequence[] {
  const scored = scoredOptions.filter((o) => o.features && Object.keys(o.features).length > 0);
  if (scored.length < 2) return [];

  const axes = new Set<string>();
  for (const option of scored) {
    for (const key of Object.keys(option.features ?? {})) {
      if (GUIDANCE_BY_KEY.has(key)) axes.add(key);
    }
  }

  const consequences: OptionConsequence[] = [];
  for (const option of scored) {
    const strengths: Array<{ text: string; separation: number }> = [];
    const costs: Array<{ text: string; separation: number }> = [];

    for (const axis of axes) {
      const value = option.features?.[axis];
      if (typeof value !== "number") continue;
      const others = scored.filter((o) => o.id !== option.id);
      const mean = fieldMean(others, axis);
      if (mean === null) continue;
      // Only the above-mean side is stated. The catalogue phrases what a HIGH
      // score asserts; there is no sanctioned wording for the low side, and
      // inventing an inverse ("less blast radius") is exactly the fabrication
      // this module refuses.
      const separation = value - mean;
      if (separation < SEPARATION_FLOOR) continue;

      const guidance = GUIDANCE_BY_KEY.get(axis);
      if (!guidance) continue;
      // High on a cost axis is a cost; high on a benefit axis is a strength.
      const target = guidance.kind === "cost" ? costs : strengths;
      target.push({ text: guidance.highMeans, separation });
    }

    strengths.sort((a, b) => b.separation - a.separation);
    costs.sort((a, b) => b.separation - a.separation);
    consequences.push({
      optionId: option.id,
      strengths: strengths.slice(0, MAX_PER_SIDE).map((s) => s.text),
      costs: costs.slice(0, MAX_PER_SIDE).map((c) => c.text),
    });
  }

  return consequences.filter((c) => c.strengths.length > 0 || c.costs.length > 0);
}

/** Index consequences by option id for rendering. */
export function consequencesByOption(
  consequences: OptionConsequence[],
): Map<string, OptionConsequence> {
  return new Map(consequences.map((c) => [c.optionId, c]));
}

/**
 * Section labels for the consequence lists. They live here rather than in the
 * page so the copy that describes a scoring axis and the copy that frames it
 * stay in one module.
 */
export const CONSEQUENCE_LABELS = {
  strengths: "Best at",
  costs: "Costs",
} as const;
