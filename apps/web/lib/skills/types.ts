// Shared types for the governed Hermes-style skill telemetry surface.
// SKILL.md authors invoke skills with `Use the \`<skill-id>\` skill.` — the
// phase names mirror Hermes' usage lifecycle (eligible → loaded → invoked →
// completed | failed | rated) so reflection can correlate without bespoke
// status maps per call site.

export const SKILL_USAGE_PHASES = [
  "eligible",
  "loaded",
  "invoked",
  "completed",
  "failed",
  "rated",
] as const;

export type SkillUsagePhase = (typeof SKILL_USAGE_PHASES)[number];

/**
 * Aggregator period key. ISO month (`YYYY-MM`) keeps SkillMetric rows compact
 * and lets weekly/daily windows be derived later without changing the column.
 */
export function getSkillMetricPeriod(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7);
}
