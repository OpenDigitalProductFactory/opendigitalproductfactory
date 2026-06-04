// apps/web/lib/workspace-home/telemetry.ts
// Observability side-channel for the workspace-home resolver.
//
// Kept separate from registry.ts so the resolver itself remains a pure function
// (easy to test, easy to reason about) and the metric is an opt-in side effect
// at the call site. The /workspace server component calls this after resolution;
// the activation-summary path (setup browsing N archetypes) intentionally does
// not, to avoid inflating the counter with exploratory reads.

import type { WorkspaceHomeArchetypeRef, WorkspaceHomeResolution } from "./types";

type CounterLike = {
  inc(labels: { match: string; has_archetype: string }): void;
};

// The default counter is the workspace-home Prometheus counter on the live
// metrics registry. Tests inject a fake CounterLike.
let defaultCounter: CounterLike | null = null;

async function getDefaultCounter(): Promise<CounterLike> {
  if (defaultCounter) return defaultCounter;
  // Late import to avoid pulling prom-client into the resolver's purity boundary
  // and to keep registry.ts free of the operate/* dependency. The metrics
  // module collects default Node metrics on import; importing it lazily means
  // unit tests that exercise the resolver path don't pay that cost.
  const { workspaceHomeResolutionsTotal } = await import("../operate/metrics");
  defaultCounter = workspaceHomeResolutionsTotal;
  return defaultCounter;
}

/**
 * Record a /workspace render's resolver outcome into the
 * `dpf_workspace_home_resolutions_total` counter.
 *
 * Surfaces the substrate's honest-fallback case (a configured archetype with no
 * matching contribution) as a Prometheus metric so it can be alerted on instead
 * of discovered by per-customer inspection.
 *
 * Call from the /workspace server component AFTER {@link resolveWorkspaceHomeContribution}
 * returns. Do not call from the setup activation-summary path — that is
 * exploratory and would inflate the counter.
 */
export async function recordWorkspaceHomeResolution(
  resolution: WorkspaceHomeResolution,
  archetypeRef: WorkspaceHomeArchetypeRef | null,
  counter?: CounterLike,
): Promise<void> {
  const hasArchetype =
    archetypeRef !== null &&
    (archetypeRef.archetypeId !== null || archetypeRef.category !== null);

  const c = counter ?? (await getDefaultCounter());
  c.inc({
    match: resolution.match,
    has_archetype: hasArchetype ? "true" : "false",
  });
}
