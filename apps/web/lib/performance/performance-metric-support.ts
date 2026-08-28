// Single source of truth for which business archetypes the performance-metrics
// engine can actually produce snapshots for.
//
// The engine only has a source loader for hospitality today (loadRestaurantSource
// in business-metric-rollup.server.ts reads HospitalityResource / ServiceTurn /
// CapacityAllocation / StorefrontBooking). An install on any other archetype has
// no rows to read, so the hourly aggregator would scan nothing and the
// /performance surface would sit at "not computed yet" forever.
//
// Both sides read this one set so they cannot drift: the aggregator uses it to
// decide which storefront contexts to scan, and the surface uses it to tell the
// owner the truth — a pending snapshot ("not computed yet") versus a surface that
// is simply not available for this business type yet.
//
// BI-F359E1E9: before this, the aggregator was hardcoded to "restaurant" and the
// surface always implied a snapshot was pending, on installs that would never
// produce one.
export const PERFORMANCE_METRIC_ARCHETYPES = ["restaurant"] as const;

export type PerformanceMetricArchetype =
  (typeof PERFORMANCE_METRIC_ARCHETYPES)[number];

/** True when the performance-metrics engine has a source loader for this archetype. */
export function archetypeHasPerformanceMetrics(archetypeId: string): boolean {
  return (PERFORMANCE_METRIC_ARCHETYPES as readonly string[]).includes(archetypeId);
}
