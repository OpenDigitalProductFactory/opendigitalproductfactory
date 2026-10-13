// apps/web/lib/build/build-phase-route-options.ts
//
// Build Studio's routed phases (plan generation, design review, pre-spec
// research, decomposition proposal) are non-interactive: nobody watches tokens
// arrive. inferContract defaults `requiresStreaming` to true for a sync
// contract — right for a chat surface, wrong here — and that default hard-
// excluded every CLI-backed engine (codex, claude, grok), whose endpoints do
// not stream tokens. Every routed build phase composes its routeAndCall
// options from this one place so the demand is stated once (BI-F84887FF).

// Keep existing Build Studio callers on the canonical inference contract.
export {
  BACKGROUND_ROUTE_OPTIONS as BUILD_PHASE_ROUTE_OPTIONS,
  backgroundRouteOptions as buildPhaseRouteOptions,
} from "@/lib/inference/background-route-options";
