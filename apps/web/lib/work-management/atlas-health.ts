/**
 * Work Atlas health: the one vocabulary for "how is this workroom doing" (BI-930A4C88).
 *
 * Every surface that groups workrooms by health derives membership from
 * `classifyAtlasHealth` and keeps only its own labels, so no two pages can
 * disagree about the same room. Surfaces translate their own durable facts
 * (liveness, drive state, task runs, approvals) into `AtlasHealthFacts`; the
 * precedence below is the single place that decides which fact wins.
 *
 * Design: docs/superpowers/specs/2026-10-27-work-atlas-design.md §6 rule 1.
 *
 * Pure and synchronous.
 */

export const ATLAS_HEALTH_STATES = ["needs-person", "stuck", "working", "waiting", "no-signal", "finished"] as const;
export type AtlasHealth = (typeof ATLAS_HEALTH_STATES)[number];

export type AtlasHealthFacts = {
  /** A recorded decision, approval, owner or closeout is waiting on a person. */
  needsPerson: boolean;
  /** Work is held: blocked, failed, paused by the drive, stalled or contradictory. */
  held: boolean;
  /** The room is closed: delivered, completed, archived or ended. */
  finished: boolean;
  /** Nothing durable says what the room is doing. */
  noSignal: boolean;
  /** The room is waiting its turn: capacity, a paused session, a held lease or input. */
  waiting: boolean;
  /** An executor is demonstrably working. */
  working: boolean;
};

/**
 * A person's decision outranks a hold, and a hold outranks completion, so an
 * owed decision is never hidden behind a closed status. Silence outranks
 * waiting and working, so a room is never shown as progressing on no evidence.
 * A room with no facts is waiting its turn, never working.
 */
export function classifyAtlasHealth(facts: AtlasHealthFacts): AtlasHealth {
  if (facts.needsPerson) return "needs-person";
  if (facts.held) return "stuck";
  if (facts.finished) return "finished";
  if (facts.noSignal) return "no-signal";
  if (facts.waiting) return "waiting";
  if (facts.working) return "working";
  return "waiting";
}

/** True for the states an operator should look at. */
export function atlasHealthNeedsLook(health: AtlasHealth): boolean {
  return health === "needs-person" || health === "stuck" || health === "no-signal";
}
