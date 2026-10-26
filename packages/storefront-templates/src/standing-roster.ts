// Standing-room roster derivation (BI-0536A59F / Coordinated Workrooms Phase F).
//
// Sibling of standing-rooms.ts: the archetype layer already says which rooms a
// kind of business needs. This file says which AI coworker each driven room
// requires, joined from the same gates. Instance staffing — who is actually
// employed — lives on live Agent rows, never here.
//
// The shapeKey → agentSlug table is frozen because this package must not import
// the platform work-shape module. A conformance test in apps/web asserts the
// table equals the first agent stage of STANDING_SHAPES.

import type { ArchetypeDefinition } from "./types";
import { deriveStandingRooms } from "./standing-rooms";

/**
 * Required coworker slug for each standing-room shapeKey. Keys are work-shape
 * keys held as strings (same contract as standing-rooms). Values are canonical
 * `agent_name` slugs already named by those shapes' agent stages.
 */
export const STANDING_SHAPE_REQUIRED_AGENT: Readonly<Record<string, string>> = Object.freeze({
  "credential-hygiene-watch": "security-engineer",
  "inquiry-response-watch": "customer-advisor",
  "adopter-health-watch": "customer-advisor",
  "payables-watch": "finance-controller",
  "vendor-renewal-watch": "finance-controller",
  "contributor-intake-watch": "platform-engineer",
  "coworker-fitness-watch": "platform-engineer",
  "dependency-advisory-watch": "security-engineer",
  "repository-policy-drift-watch": "platform-engineer",
  "pull-request-flow-watch": "change-reviewer",
  "issue-triage-watch": "portfolio-advisor",
  "release-readiness-watch": "build-specialist",
});

export type RequiredRosterRole = {
  agentSlug: string;
  shapeKeys: string[];
};

/**
 * Pure derivation: archetype → unique coworker slugs required by its standing
 * rooms. Group rooms (`shapeKey: null`) add no role. A driven room whose
 * shapeKey is missing from the frozen map is a contract break, not a skip.
 */
export function deriveRequiredRoster(archetype: ArchetypeDefinition): RequiredRosterRole[] {
  const bySlug = new Map<string, string[]>();
  for (const room of deriveStandingRooms(archetype)) {
    if (!room.shapeKey) continue;
    const slug = STANDING_SHAPE_REQUIRED_AGENT[room.shapeKey];
    if (!slug) {
      throw new Error(`standing roster map missing shapeKey ${room.shapeKey}`);
    }
    const keys = bySlug.get(slug) ?? [];
    keys.push(room.shapeKey);
    bySlug.set(slug, keys);
  }
  return [...bySlug.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([agentSlug, shapeKeys]) => ({
      agentSlug,
      shapeKeys: [...shapeKeys].sort(),
    }));
}
