// apps/web/lib/build/build-phase-route-options.ts
//
// Build Studio's routed phases (plan generation, design review, pre-spec
// research, decomposition proposal) are non-interactive: nobody watches tokens
// arrive. inferContract defaults `requiresStreaming` to true for a sync
// contract — right for a chat surface, wrong here — and that default hard-
// excluded every CLI-backed engine (codex, claude, grok), whose endpoints do
// not stream tokens. Every routed build phase composes its routeAndCall
// options from this one place so the demand is stated once (BI-F84887FF).

import type { RouteAndCallOptions } from "@/lib/inference/routed-inference-options";

export const BUILD_PHASE_ROUTE_OPTIONS = { requiresStreaming: false } as const satisfies RouteAndCallOptions;

/** routeAndCall options for a non-interactive Build Studio phase, plus any per-call extras. */
export function buildPhaseRouteOptions<T extends RouteAndCallOptions>(
  extra?: T,
): Omit<T, "requiresStreaming"> & { requiresStreaming: false } {
  return { ...(extra ?? ({} as T)), ...BUILD_PHASE_ROUTE_OPTIONS };
}
