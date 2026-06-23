/**
 * EP-GOLDEN-TRIANGLE Slice 2 (BI-D48EB34C) — pure display helpers for the
 * posture control: triangle geometry (weights <-> point in a 0..1 unit space)
 * and a human-readable summary of what a compiled DecodedPolicy configures.
 *
 * Pure: no React, no I/O. The decode chips are derived from the real Slice 1
 * compiler so the UI never drifts from what actually gets configured.
 */
import { compileGoldenTrianglePolicy } from "@/lib/golden-triangle";
import type {
  DecodedPolicy,
  GoldenTrianglePreference,
  GoldenTrianglePreset,
} from "@/lib/golden-triangle";

// ── Triangle geometry (unit space; the component scales to its SVG size) ──────
// Quality = top, Cost = bottom-left, Time = bottom-right.
const V = {
  quality: { x: 0.5, y: 0 },
  cost: { x: 0, y: 1 },
  time: { x: 1, y: 1 },
} as const;

export interface UnitPoint {
  x: number;
  y: number;
}

export function weightsToPoint(qualityWeight: number, costWeight: number, timeWeight: number): UnitPoint {
  const q = Math.max(0, qualityWeight);
  const c = Math.max(0, costWeight);
  const t = Math.max(0, timeWeight);
  const s = q + c + t || 1;
  const nq = q / s;
  const nc = c / s;
  const nt = t / s;
  return {
    x: nq * V.quality.x + nc * V.cost.x + nt * V.time.x,
    y: nq * V.quality.y + nc * V.cost.y + nt * V.time.y,
  };
}

export interface Weights {
  qualityWeight: number;
  costWeight: number;
  timeWeight: number;
}

/** Barycentric inverse: a unit point inside the triangle → normalized weights. */
export function pointToWeights(x: number, y: number): Weights {
  const denom = (V.cost.y - V.time.y) * (V.quality.x - V.time.x) + (V.time.x - V.cost.x) * (V.quality.y - V.time.y);
  let q = ((V.cost.y - V.time.y) * (x - V.time.x) + (V.time.x - V.cost.x) * (y - V.time.y)) / denom;
  let c = ((V.time.y - V.quality.y) * (x - V.time.x) + (V.quality.x - V.time.x) * (y - V.time.y)) / denom;
  let t = 1 - q - c;
  q = Math.max(0, q);
  c = Math.max(0, c);
  t = Math.max(0, t);
  const s = q + c + t || 1;
  return { qualityWeight: q / s, costWeight: c / s, timeWeight: t / s };
}

// ── Presets ───────────────────────────────────────────────────────────────
// [quality, cost, time] — mirrors the Slice 1 compiler's canonical postures.
export const PRESET_WEIGHTS: Record<Exclude<GoldenTrianglePreset, "custom">, [number, number, number]> = {
  fast: [0.1, 0.1, 0.8],
  balanced: [0.34, 0.33, 0.33],
  assured: [0.8, 0.1, 0.1],
  frugal: [0.1, 0.8, 0.1],
};

export const PRESET_ORDER: Array<Exclude<GoldenTrianglePreset, "custom">> = [
  "fast",
  "balanced",
  "assured",
  "frugal",
];

export const PRESET_META: Record<Exclude<GoldenTrianglePreset, "custom">, { label: string; icon: string; effect: string }> = {
  fast: { label: "Fast", icon: "clock", effect: "Quickest. Less checking." },
  balanced: { label: "Balanced", icon: "scale", effect: "A sensible mix." },
  assured: { label: "Assured", icon: "diamond", effect: "Most checking." },
  frugal: { label: "Frugal", icon: "coin", effect: "Spends the least." },
};

export function preferenceFromPreset(preset: Exclude<GoldenTrianglePreset, "custom">): GoldenTrianglePreference {
  const [qualityWeight, costWeight, timeWeight] = PRESET_WEIGHTS[preset];
  return { preset, qualityWeight, costWeight, timeWeight };
}

// ── Plain-language summary ──────────────────────────────────────────────────
const PLAIN: Record<Exclude<GoldenTrianglePreset, "custom">, string> = {
  fast: "Quickest result. Less checking.",
  balanced: "A sensible balance — platform defaults.",
  assured: "Strongest model, deeper review. Higher cost and time.",
  frugal: "Spends the least. May take a little longer.",
};

function dominantAxis(p: GoldenTrianglePreference): { axis: "quality" | "cost" | "time"; weight: number } {
  const s = Math.max(0, p.qualityWeight) + Math.max(0, p.costWeight) + Math.max(0, p.timeWeight) || 1;
  const q = Math.max(0, p.qualityWeight) / s;
  const c = Math.max(0, p.costWeight) / s;
  const t = Math.max(0, p.timeWeight) / s;
  let axis: "quality" | "cost" | "time" = "quality";
  let weight = q;
  if (c > weight) {
    axis = "cost";
    weight = c;
  }
  if (t > weight) {
    axis = "time";
    weight = t;
  }
  return { axis, weight };
}

export function plainSummary(pref: GoldenTrianglePreference): string {
  if (pref.preset !== "custom") return PLAIN[pref.preset];
  const { axis, weight } = dominantAxis(pref);
  if (weight < 0.4) return PLAIN.balanced;
  if (axis === "quality") return weight >= 0.55 ? PLAIN.assured : "Leaning toward getting it right.";
  if (axis === "cost") return weight >= 0.55 ? PLAIN.frugal : "Leaning toward saving money.";
  return weight >= 0.55 ? PLAIN.fast : "Leaning toward speed.";
}

// ── Configured-chips (driven by the real compiler output) ────────────────────
export interface ConfigChip {
  /** Tabler-style icon key (the component prefixes with `ti ti-`). */
  icon: string;
  label: string;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function budgetLabel(b: string): string {
  if (b === "minimize_cost") return "Cost-first";
  if (b === "quality_first") return "Quality-first";
  return "Balanced cost";
}

export function describeConfigured(decoded: DecodedPolicy): ConfigChip[] {
  const po = decoded.postureOverride;
  const ob = decoded.orchestrationBudget;
  const chips: ConfigChip[] = [];
  if (po.minimumTier) chips.push({ icon: "diamond", label: `${cap(po.minimumTier)} tier` });
  if (po.effort) chips.push({ icon: "bolt", label: `${cap(po.effort)} effort` });
  if (po.budgetClass) chips.push({ icon: "coin", label: budgetLabel(po.budgetClass) });
  if (ob.verificationDepth && ob.verificationDepth !== "none") {
    chips.push({ icon: "checks", label: `${cap(ob.verificationDepth)} verification` });
  }
  if (ob.deliberationPattern) chips.push({ icon: "users", label: cap(ob.deliberationPattern) });
  if (ob.retryBudget !== undefined) {
    chips.push({ icon: "refresh", label: `${ob.retryBudget} ${ob.retryBudget === 1 ? "retry" : "retries"}` });
  }
  if (po.maxLatencyMs !== undefined) chips.push({ icon: "clock", label: `${Math.round(po.maxLatencyMs / 1000)}s target` });
  if (chips.length === 0) chips.push({ icon: "adjustments-horizontal", label: "Platform defaults" });
  return chips;
}

export interface PostureView {
  decoded: DecodedPolicy;
  plain: string;
  chips: ConfigChip[];
}

/** Compile a preference and produce everything the control needs to display. */
export function decodePostureForDisplay(
  pref: GoldenTrianglePreference,
  taskClass = "conversation",
  authorityScopeKind = "wwmd",
): PostureView {
  const decoded = compileGoldenTrianglePolicy({
    preference: pref,
    taskClass,
    authorityScope: { kind: authorityScopeKind },
  });
  return { decoded, plain: plainSummary(pref), chips: describeConfigured(decoded) };
}

// ── Balance / starvation colouring ──────────────────────────────────────────
// Green when the three axes are in balance (centre), shading through yellow to
// red as one or two axes get starved (the posture pushes toward an edge/vertex).
export type BalanceLevel = "balanced" | "leaning" | "starved";

export interface BalanceState {
  level: BalanceLevel;
  /** A `--dpf-*` token name (without `var()`) for the level's colour. */
  token: "--dpf-success" | "--dpf-warning" | "--dpf-error";
  label: string;
  /** Axis labels currently starved (weight below the floor). */
  starved: Array<"Quality" | "Cost" | "Time">;
}

const STARVE_FLOOR = 0.12;

export function balanceState(qualityWeight: number, costWeight: number, timeWeight: number): BalanceState {
  const q = Math.max(0, qualityWeight);
  const c = Math.max(0, costWeight);
  const t = Math.max(0, timeWeight);
  const s = q + c + t || 1;
  const nq = q / s;
  const nc = c / s;
  const nt = t / s;

  const starved: Array<"Quality" | "Cost" | "Time"> = [];
  if (nq < STARVE_FLOOR) starved.push("Quality");
  if (nc < STARVE_FLOOR) starved.push("Cost");
  if (nt < STARVE_FLOOR) starved.push("Time");

  // 1 = perfectly balanced (1/3 each); 0 = an axis fully starved (a vertex/edge).
  const score = Math.min(nq, nc, nt) * 3;
  let level: BalanceLevel;
  let token: BalanceState["token"];
  if (score >= 0.66) {
    level = "balanced";
    token = "--dpf-success";
  } else if (score >= 0.33) {
    level = "leaning";
    token = "--dpf-warning";
  } else {
    level = "starved";
    token = "--dpf-error";
  }

  const label =
    level === "balanced" ? "Well balanced" : starved.length > 0 ? `Starving ${starved.join(" & ")}` : "Leaning";

  return { level, token, label, starved };
}

export function isAxisStarved(b: BalanceState, axis: "Quality" | "Cost" | "Time"): boolean {
  return b.starved.includes(axis);
}
