// Consolidated owner-facing proactivity roster (BI-65D622EA). One place that
// lists every coworker with the proactivity level it acts at, states that the
// default was DERIVED from the business risk posture, and lets the owner confirm
// or adjust each one. The per-agent adjust already lives on the coworker profile
// (CoworkerProfilePanel); this is the aggregated view, reusing the same resolver
// and the same saveCoworkerProactivityPreference write path. Spec:
// docs/superpowers/specs/2026-07-17-needs-you-cognitive-load-redesign-design.md
// (deferred surface: proactivity confirm/adjust).

import { resolveProactivityPlan, resolveProactivityPlanForLevel } from "./proactivity-resolver";
import type { ProactivityLevel } from "./proactivity-types";

export type ProactivityRosterAgent = {
  agentId: string;
  displayName: string;
  role: string;
};

export type ProactivityRosterRow = ProactivityRosterAgent & {
  level: ProactivityLevel;
  /** True when the owner has overridden the derived default. */
  isOverride: boolean;
  /** Plain-language origin of the level shown. */
  explanation: string;
};

/** Pure projection: given the coworker list and any owner overrides, resolve the
 *  level each coworker acts at. When no override exists the resolver returns the
 *  posture-derived default; an override marks the row as owner-set. */
export function deriveProactivityRoster(
  agents: ProactivityRosterAgent[],
  overrides: Record<string, ProactivityLevel>,
): ProactivityRosterRow[] {
  return agents.map((agent) => {
    const input = { activityFamily: "scheduled-task", agentId: agent.agentId } as const;
    const saved = overrides[agent.agentId];
    const plan = saved
      ? resolveProactivityPlanForLevel(input, saved, "user-override")
      : resolveProactivityPlan(input);
    return {
      ...agent,
      level: plan.resolvedLevel,
      isOverride: Boolean(saved),
      explanation: plan.explanation,
    };
  });
}
