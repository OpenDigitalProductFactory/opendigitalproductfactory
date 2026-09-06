// Consolidated owner-facing proactivity roster (BI-65D622EA). One place that
// lists every coworker with the proactivity level it acts at, states that the
// default was DERIVED from the business risk posture, and lets the owner confirm
// or adjust each one. The per-agent adjust already lives on the coworker profile
// (CoworkerProfilePanel); this is the aggregated view, reusing the same resolver
// and the same saveCoworkerProactivityPreference write path. Spec:
// docs/superpowers/specs/2026-07-17-needs-you-cognitive-load-redesign-design.md
// (deferred surface: proactivity confirm/adjust).

import { resolveProactivityPlan } from "./proactivity-resolver";
import type { ProactivityLevel } from "./proactivity-types";
import {
  ownerFacingAreaForPortfolio,
  type OwnerFacingArea,
} from "@/lib/coworker-record/owner-areas";

export type ProactivityRosterAgent = {
  agentId: string;
  displayName: string;
  role: string;
  /** Canonical portfolio slug the coworker belongs to; drives the grouping. */
  portfolioSlug?: string | null;
};

/** An owner-friendly business area, ordered from the customer inward (the same
 *  outside-in axis the attention inbox uses), so the 100+ coworker roster reads
 *  as a few navigable sections rather than a flat dump. */
export type ProactivityArea = OwnerFacingArea;

export function areaForPortfolio(slug: string | null | undefined): ProactivityArea {
  return ownerFacingAreaForPortfolio(slug);
}

export type ProactivityRosterRow = ProactivityRosterAgent & {
  level: ProactivityLevel;
  /** True when the owner has overridden the derived default. */
  isOverride: boolean;
  /** Plain-language origin of the level shown. */
  explanation: string;
  /** The business area this row is grouped under. */
  area: ProactivityArea;
};

export type ProactivityAreaGroup = {
  area: ProactivityArea;
  rows: ProactivityRosterRow[];
};

/** Group resolved rows into owner-friendly areas, ordered customer-inward.
 *  Coworker order within an area is preserved from the input. */
export function groupRosterByArea(rows: ProactivityRosterRow[]): ProactivityAreaGroup[] {
  const byKey = new Map<string, ProactivityAreaGroup>();
  for (const row of rows) {
    const existing = byKey.get(row.area.key);
    if (existing) existing.rows.push(row);
    else byKey.set(row.area.key, { area: row.area, rows: [row] });
  }
  return [...byKey.values()].sort((a, b) => a.area.order - b.area.order);
}

/** Pure projection: the level each coworker acts at when it is working outside
 *  any workroom.
 *
 *  BI-87C9C91C: this used to layer a saved per-coworker override on top. Those
 *  overrides no longer influence resolution anywhere, so reading one here would
 *  display a level nothing honours — a report that lies. The row now shows the
 *  derived default only, and `isOverride` is always false. */
export function deriveProactivityRoster(
  agents: ProactivityRosterAgent[],
): ProactivityRosterRow[] {
  return agents.map((agent) => {
    const plan = resolveProactivityPlan({ activityFamily: "scheduled-task" });
    return {
      ...agent,
      level: plan.resolvedLevel,
      isOverride: false,
      explanation: plan.explanation,
      area: areaForPortfolio(agent.portfolioSlug),
    };
  });
}
