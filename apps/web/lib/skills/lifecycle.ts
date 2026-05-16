// Skill operational-lifecycle taxonomy for Slice 4 of the governed Hermes
// learning loop.
//
// This axis is **separate** from `SkillDefinition.status` (which carries
// adoption stage: `discovered | evaluated | approved | installed | active |
// deprecated`). Lifecycle is operational health — is this skill being used,
// decaying, intentionally protected, or under quarantine.
//
// Both axes coexist on `SkillDefinition`. The curator writes only this one.
//
// Spec: docs/superpowers/specs/2026-05-15-governed-hermes-learning-loop-design.md §6.1.1

export const SKILL_LIFECYCLE_STATES = [
  "active",
  "stale",
  "pinned",
  "quarantined",
  "archived",
] as const;

export type SkillLifecycleState = (typeof SKILL_LIFECYCLE_STATES)[number];

export function isSkillLifecycleState(value: unknown): value is SkillLifecycleState {
  return typeof value === "string" && (SKILL_LIFECYCLE_STATES as readonly string[]).includes(value);
}

/**
 * Sticky operator-set states the curator never moves out of. Pin protection
 * is enforced here so any future curator caller can ask the same question
 * without duplicating the predicate.
 */
export function isCuratorImmutable(state: SkillLifecycleState): boolean {
  return state === "pinned" || state === "quarantined";
}

export type ClassifyInput = {
  /** Current lifecycle state. Sticky states short-circuit. */
  current: SkillLifecycleState;
  /** Usage over the last 30 days, grouped by phase. */
  usage30d: { invoked: number; failed: number };
  /** Number of coworkers this skill is assigned to. */
  assignmentCount: number;
  /** Latest SkillUsageEvent.createdAt for this skill, or null. */
  lastUsedAt: Date | null;
  /** True when SkillDefinition.skillMdContent is non-empty. */
  hasContent: boolean;
};

export type ClassifyResult = {
  next: SkillLifecycleState;
  reason: string;
};

/**
 * Decide where a skill should sit on the operational-health axis. Pure
 * function — no DB I/O — so the curator can call it inside a tight loop
 * without scaling concerns.
 *
 * Rules (top to bottom):
 *   1. pinned / quarantined are sticky. The curator never moves a skill
 *      out of them; operator action does. Returning the same state with
 *      a clear reason keeps the audit trail honest.
 *   2. Empty SKILL.md content with no assignments and no invocations →
 *      archived (recoverable; the operator can flip back to active).
 *   3. Empty content with assignments OR invocations → stale (curator
 *      asks the operator to either populate or remove).
 *   4. Zero invocations in 30 days but has assignments → stale.
 *   5. Otherwise → active.
 */
export function classifySkillLifecycle(input: ClassifyInput): ClassifyResult {
  if (isCuratorImmutable(input.current)) {
    return {
      next: input.current,
      reason: `operator-set state '${input.current}' preserved`,
    };
  }

  if (!input.hasContent && input.assignmentCount === 0 && input.usage30d.invoked === 0) {
    return { next: "archived", reason: "no content, no assignments, no use" };
  }

  if (!input.hasContent) {
    return { next: "stale", reason: "skill has no SKILL.md body yet" };
  }

  if (input.usage30d.invoked === 0) {
    return { next: "stale", reason: "no invocations in the last 30 days" };
  }

  return { next: "active", reason: "in use" };
}
