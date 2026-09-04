// apps/web/lib/operate/platform-health.ts — EP-8DC217EB BET-10
//
// One canonical health verdict for the platform. The read side of health is
// scattered across six surfaces, each with its own status vocabulary:
//   - workspace/command-center.ts        (metric tiles)
//   - operate/scheduled-jobs/work-model.ts (deriveHealth → ok|error|overdue|never|spent)
//   - operate/dependency-health.ts       (boolean probes: neo4j / model-runner / stt)
//   - operate/health-probe-bridge.ts     (container/service probe metrics)
//   - observability/alert-sources.ts     (alert feed)
//   - tak/mcp-server-health.ts           (MCP server reachability)
//
// This module is ADDITIVE: it does not replace any of those surfaces. It gives
// them a single aggregating façade — normalize each surface's signal into a
// common ComponentHealth, then roll the components up with worst-status-wins.
// Pure and unit-tested; callers (incl. the runtime-health page and BI-83AC1A03's
// reporting composer) inject already-collected signals so this stays IO-free.

/** Common health vocabulary the six surfaces normalize into. */
export type ComponentHealth = "healthy" | "degraded" | "down" | "unknown";

export interface HealthComponent {
  /** Stable component name, e.g. "scheduled-jobs", "neo4j", "mcp:filesystem". */
  name: string;
  status: ComponentHealth;
  /** Optional human-readable detail for the surfacing UI. */
  detail?: string;
}

export interface PlatformHealth {
  /** Worst-status-wins rollup across every component. */
  status: ComponentHealth;
  /** True only when the rollup is "healthy" (every known component is healthy). */
  healthy: boolean;
  components: HealthComponent[];
  /** Counts per status for a compact badge/summary. */
  counts: Record<ComponentHealth, number>;
}

// Severity order: a single "down" dominates; then "degraded"; "unknown" is
// worse than "healthy" (we don't claim health we haven't observed) but never
// escalates past a real "degraded"/"down".
const SEVERITY: Record<ComponentHealth, number> = {
  down: 3,
  degraded: 2,
  unknown: 1,
  healthy: 0,
};

/** Normalize a scheduled-job health ("ok"|"error"|"never") into ComponentHealth. */
export function fromJobHealth(health: "ok" | "error" | "never"): ComponentHealth {
  if (health === "ok") return "healthy";
  if (health === "error") return "down";
  return "unknown"; // "never" ran yet — not observed, not a failure
}

/** Normalize a boolean liveness probe (true = reachable) into ComponentHealth. */
export function fromProbe(reachable: boolean): ComponentHealth {
  return reachable ? "healthy" : "down";
}

/**
 * Roll a set of component signals into one platform verdict. Worst-status-wins;
 * an empty component set is "unknown" (we have observed nothing). Pure.
 */
export function aggregatePlatformHealth(components: HealthComponent[]): PlatformHealth {
  const counts: Record<ComponentHealth, number> = {
    healthy: 0,
    degraded: 0,
    down: 0,
    unknown: 0,
  };
  let worst: ComponentHealth = components.length === 0 ? "unknown" : "healthy";
  for (const c of components) {
    counts[c.status] += 1;
    if (SEVERITY[c.status] > SEVERITY[worst]) worst = c.status;
  }
  return {
    status: worst,
    healthy: worst === "healthy",
    components,
    counts,
  };
}

/** Convenience boolean: is every known component healthy? */
export function isPlatformHealthy(components: HealthComponent[]): boolean {
  return aggregatePlatformHealth(components).healthy;
}
