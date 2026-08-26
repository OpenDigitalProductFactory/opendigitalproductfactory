// apps/web/lib/routing/local-tool-ceiling.ts
//
// How many tool schemas a LOCAL model may be handed, and whether one is in the
// serving path at all. The SINGLE source of both (INV-6).
//
// WHY THIS LIVES IN `routing`. The ceiling is a routing policy: `fallback.ts`
// enforces it when it decides whether a local endpoint may take a turn. But the
// attachment budget (`lib/actions`) must apply the same number when it sizes the
// surface, and the local posture is produced in `lib/inference`. `routing` is the
// inner boundary of the application DAG — every other context may depend on it
// and it depends on nothing — so it is the only layer all three can legally
// share. Defining these in `lib/tak` forced an `inference -> tak` reverse edge
// that the application-boundary guard correctly refused (BI-A8BFEFCE).
//
// Pure: no imports, no I/O.

/**
 * The point past which a small local model's tool-SELECTION accuracy collapses.
 * A property of the model class, not of its context window — a large served
 * window means the tools FIT, not that the model can CHOOSE among them.
 *
 * `lib/tak/context-economy-metrics.ts` re-exports this so its existing consumers
 * are unaffected.
 */
export const LOCAL_TOOL_SELECTION_CLIFF = 15;

/**
 * Whether a local generation model is in the serving path for this turn.
 *
 * The distinction that matters is `absent` vs `unknown` (BI-A8BFEFCE). Callers
 * used to report both as a null served-context window, and the cap derivation
 * read that null as "pure cloud turn" and lifted the attached surface to the
 * full 48 — the one value guaranteed to make the routing layer refuse the local
 * fallback. So a failed READ of local capacity silently deleted local from the
 * chain, and a cloud rate-limit on top of it produced a turn that executed
 * nothing at all. `unknown` must therefore behave like `present`, not `absent`.
 */
export type LocalPresence = "present" | "absent" | "unknown";

/**
 * The largest attached tool surface a LOCAL model may be handed.
 *
 * A small local model is cliff-prone by CLASS, so the fail-safe is the selection
 * cliff. Only MEASURED tool-selection fidelity evidence (produced by the eval
 * harness, persisted on `ModelProfile.customScores`) lifts it; a bigger context
 * window never does — capacity is not fidelity (BI-B5C358B1).
 *
 * Both the attachment budget and the fallback gate call this so they cannot
 * drift apart. Before it existed the budget honoured a measured ceiling while
 * the gate hardcoded the raw cliff, so the moment fidelity was measured above 15
 * the budget would attach more tools than the gate would agree to run. Pure.
 */
export function resolveLocalToolCeiling(
  measuredToolFidelityCeiling?: number | null,
): number {
  const measured = measuredToolFidelityCeiling;
  if (typeof measured !== "number" || !Number.isFinite(measured) || measured <= 0) {
    return LOCAL_TOOL_SELECTION_CLIFF;
  }
  return Math.floor(measured);
}
