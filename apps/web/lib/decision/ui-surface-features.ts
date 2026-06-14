// Interface-surface scoring for the `remove-avoidable-failure-opportunities`
// kernel principle (founder-kernel §"Interface surface is failure surface").
//
// Mirrors the browser-drive means-selector pattern (./../browser-drive/select-means.ts):
// derive a feature vector from change signals, then let a scoped `principle_decide`
// call weigh "ship this surface as designed" against the "retire / rework" baseline.
// A new control must BEAT removal to pass — which is how "removing interfaces is
// better" becomes a scored gate rather than a slogan.
//
// Operator rubric (2026-06-14), encoded in `classifyUiSurfaceTier`:
//   no-op   — no interface change; the dimension does not apply.
//   removal — the change retires surface; favored.
//   high    — clarification interaction → better outcome, reusable across many
//             internal outcomes long-term, backed by research/evidence.
//   mid     — well-thought-out + justified, but narrow reuse.
//   low     — new surface with inadequate justification/research (surface bloat).
//
// The cost axes are scored HONESTLY here (a net addition imposes
// `human_cognitive_load`), which only produces the right verdict because the
// cost-axis signs were corrected to the directional convention (PR #1904).
//
// `executeTool` (the real governed principle_decide path) is imported lazily
// inside `scoreUiSurfaceChange` only when no executor is injected, so the pure
// derivation functions stay free of the heavy mcp-tools import graph.

export const UI_SURFACE_SELECT_SURFACE = "design-gate-ui-surface";

export type UiSurfaceJustification = "none" | "weak" | "researched";

/** Signals describing an interface-surface change (counts >= 0; ratios 0..1). */
export type UiSurfaceChange = {
  /** New interactive controls: buttons, fillable fields, forms, routes. */
  controlsAdded: number;
  /** Retired controls (collapsed into a derived value, replaced by an automatic step, deleted). */
  controlsRemoved: number;
  /** Evidence backing the added surface. */
  justification: UiSurfaceJustification;
  /** Breadth of long-term reuse across internal outcomes (0 single .. 1 many). */
  reuseBreadth: number;
  /** Does the control clarify intent toward a demonstrably better outcome? (0..1) */
  clarifiesOutcome: number;
};

export type UiSurfaceTier = "no-op" | "removal" | "high" | "mid" | "low";

const clamp = (n: number): number => Math.max(0, Math.min(1, n));

const EVIDENCE: Record<UiSurfaceJustification, number> = {
  none: 0.1,
  weak: 0.5,
  researched: 0.9,
};

/**
 * Classify a surface change into the operator rubric tier. Pure — the gate uses
 * this for the human-readable verdict; `scoreUiSurfaceChange` produces the
 * principle_decide-backed pass/soft-block decision.
 */
export function classifyUiSurfaceTier(change: UiSurfaceChange): UiSurfaceTier {
  const { controlsAdded, controlsRemoved, justification, reuseBreadth, clarifiesOutcome } = change;
  if (controlsAdded <= 0 && controlsRemoved <= 0) return "no-op";
  if (controlsAdded <= 0 && controlsRemoved > 0) return "removal";
  // A net addition with inadequate justification is low regardless of reuse —
  // "we might want it" is not justification.
  if (EVIDENCE[justification] < 0.3) return "low";
  // Justified: high requires a clarifying outcome AND broad long-term reuse;
  // otherwise the surface is amortized too thinly to be more than mid.
  if (clarifiesOutcome >= 0.5 && reuseBreadth >= 0.5) return "high";
  return "mid";
}

/**
 * Derive `principle_decide` feature vectors for the two options the gate weighs:
 *   ship   — ship the surface as designed (load bought down by justification/reuse/clarify)
 *   retire — retire / rework instead (the removal baseline the change must beat)
 *
 * Pure. Feature keys are `PRINCIPLE_DIMENSIONS`; values 0..1 = how much the
 * option exhibits that axis. `human_cognitive_load` is a cost axis: a net
 * addition imposes load, reduced by evidence + reuse + clarification; a net
 * removal imposes near-zero.
 */
export function uiSurfaceFeatures(change: UiSurfaceChange): {
  ship: Record<string, number>;
  retire: Record<string, number>;
} {
  const { controlsAdded, controlsRemoved, justification, reuseBreadth, clarifiesOutcome } = change;
  const e = EVIDENCE[justification];
  const netAddition = controlsAdded > controlsRemoved;
  // Net additions impose cognitive load; justification, reuse, and clarification
  // value buy it down. A net removal imposes near-zero.
  const load = netAddition
    ? clamp(0.85 - 0.4 * e - 0.25 * reuseBreadth - 0.2 * clarifiesOutcome)
    : 0.1;
  return {
    ship: {
      human_cognitive_load: load,
      reusability: clamp(0.15 + 0.8 * reuseBreadth),
      evidence_density: e,
      long_term_maintainability: clamp(0.3 + 0.25 * e + 0.25 * reuseBreadth + 0.15 * clarifiesOutcome),
      governance_compliance: 0.4,
      public_safety: clamp(0.3 + 0.3 * clarifiesOutcome),
    },
    retire: {
      human_cognitive_load: 0.05,
      reusability: 0.2,
      evidence_density: 0.3,
      long_term_maintainability: 0.9,
      governance_compliance: 0.5,
      public_safety: 0.4,
    },
  };
}

export type UiSurfaceVerdict = {
  tier: UiSurfaceTier;
  /** true = the surface earns its place (ship beats retire with confidence). */
  pass: boolean;
  /** Gate action: "soft-block" is overridable, recorded as evidence. */
  gate: "pass" | "soft-block" | "no-op";
  recommendation: { optionId?: string; confidence?: string; margin?: number } | null;
  /** Contribution ledger for evidence persistence. */
  ledger: unknown;
  reason: string;
};

type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  context: Record<string, unknown>,
) => Promise<{ success?: boolean; data?: Record<string, unknown>; error?: string }>;

/**
 * Score an interface-surface change at the design gate. Injectable executor for
 * tests; defaults to the platform tool executor so the real call goes through
 * the governed `principle_decide` path. No-op and pure-removal changes
 * short-circuit without a WWMD round-trip (the rubric's "no-op" / "removal").
 *
 * Gate semantics (soft-block-override, per the kernel's own WWMD verdict on
 * enforcement strength): "ship" must beat the removal baseline with high
 * confidence to pass; otherwise the gate soft-blocks — a low-scoring,
 * unjustified surface addition is held, but an operator can override with the
 * override recorded as evidence.
 */
export async function scoreUiSurfaceChange(
  change: UiSurfaceChange,
  opts: { userId: string; routeContext?: string; toolExecutor?: ToolExecutor },
): Promise<UiSurfaceVerdict> {
  const tier = classifyUiSurfaceTier(change);
  if (tier === "no-op") {
    return {
      tier,
      pass: true,
      gate: "no-op",
      recommendation: null,
      ledger: null,
      reason: "No interface surface changed; the interface-surface dimension does not apply.",
    };
  }
  if (tier === "removal") {
    return {
      tier,
      pass: true,
      gate: "pass",
      recommendation: null,
      ledger: null,
      reason: "Change retires interface surface; favored — removing interfaces is better.",
    };
  }

  const { ship, retire } = uiSurfaceFeatures(change);
  const options = [
    { id: "ship", description: "Ship the new/changed interface surface as designed.", features: ship },
    {
      id: "retire",
      description: "Retire or rework instead of adding the surface (the removal baseline).",
      features: retire,
    },
  ];

  const exec = opts.toolExecutor ?? (await import("@/lib/mcp-tools")).executeTool;
  const response = await exec(
    "principle_decide",
    {
      context:
        "A Build Studio change adds interface surface (a button, fillable field, form, or route). " +
        "Does shipping it as designed beat retiring or reworking it, given its justification and " +
        "long-term reuse? Governed by remove-avoidable-failure-opportunities — interface surface is " +
        "failure surface; a new control must earn its surface.",
      callingPopulation: "in_platform_coworker",
      callingSurface: UI_SURFACE_SELECT_SURFACE,
      options,
    },
    opts.userId,
    { routeContext: opts.routeContext ?? UI_SURFACE_SELECT_SURFACE },
  );

  const data = response.success ? response.data : undefined;
  const rec =
    (data?.recommendation as { optionId?: string; confidence?: string; margin?: number } | undefined) ?? null;
  const shipWins = rec?.optionId === "ship";
  const confident = rec?.confidence === "high";
  const pass = shipWins && confident;

  return {
    tier,
    pass,
    gate: pass ? "pass" : "soft-block",
    recommendation: rec,
    ledger: data?.scores ?? data ?? null,
    reason:
      typeof data?.reasoning === "string"
        ? (data.reasoning as string)
        : "Scored by governed decision against the removal baseline.",
  };
}
