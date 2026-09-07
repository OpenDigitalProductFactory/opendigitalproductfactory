/**
 * The room-definition contract: how a Workroom definition starts (trigger),
 * what tool authority it may confer (a ceiling, never a source), and what it
 * reports (measures). Kept apart from the registry so the vocabulary can be
 * read without the 40-odd definitions that use it.
 */
/**
 * How a room starts working without an operator opening it. A room that carries
 * no trigger is imperative: something outside it must push work in. The three
 * kinds are the closed set — an event fires it, a cadence schedules it, or a
 * threshold crossing raises it.
 */
export const WORK_CASE_ROOM_TRIGGER_KINDS = [
  "event",
  "cadence",
  "threshold",
] as const;

export type WorkCaseRoomTriggerKind =
  (typeof WORK_CASE_ROOM_TRIGGER_KINDS)[number];

/** A named signal (a booking confirmed, a statement imported) opens the room. */
export interface WorkCaseRoomEventTrigger {
  kind: "event";
  /** Domain signal name the room listens for. */
  signal: string;
  description: string;
}

/**
 * A recurrence opens the room. `rrule` is RFC-5545, the same grammar
 * `RecurrenceSchedule` stores, so a cadence room reuses the one recurrence
 * primitive instead of introducing a second scheduler.
 */
export interface WorkCaseRoomCadenceTrigger {
  kind: "cadence";
  rrule: string;
  description: string;
}

/** A measured value crossing a bound opens the room. */
export interface WorkCaseRoomThresholdTrigger {
  kind: "threshold";
  /** Measure key this watches; matches a `WorkCaseRoomMeasure.key`. */
  measureKey: string;
  comparator: "above" | "below";
  description: string;
}

export type WorkCaseRoomTrigger =
  | WorkCaseRoomEventTrigger
  | WorkCaseRoomCadenceTrigger
  | WorkCaseRoomThresholdTrigger;

/**
 * The tool authority a room confers on an agent working inside it. This is a
 * ceiling, never a source of authority: the effective grant is the intersection
 * with the agent's standing `AgentToolGrant` rows, so a room can only narrow
 * what an agent already holds. `narrowRoomToolGrant` is the single place that
 * intersection is computed.
 */
export interface WorkCaseRoomToolGrant {
  /** Grant keys the room permits, matching `AgentToolGrant.grantKey`. */
  grantKeys: readonly string[];
}

/**
 * What the room reports so its health is read rather than asserted. `bindingKey`
 * is the metric binding the resolver reads; an unresolvable binding reports
 * unmeasurable rather than zero.
 */
export interface WorkCaseRoomMeasure {
  key: string;
  label: string;
  bindingKey: string;
}

/**
 * Intersect a room's grant ceiling with the agent's standing authority.
 *
 * The room is never a source of authority. A grant key the room names but the
 * agent does not hold is refused, not conferred — so opening a room can only
 * narrow what an agent could already do. Callers that need to explain a refusal
 * read `refused`; callers enforcing authority read `granted`.
 */
export function narrowRoomToolGrant(
  roomGrant: WorkCaseRoomToolGrant,
  standingGrantKeys: readonly string[],
): { granted: string[]; refused: string[] } {
  const standing = new Set(standingGrantKeys);
  const granted: string[] = [];
  const refused: string[] = [];

  for (const key of roomGrant.grantKeys) {
    if (standing.has(key)) granted.push(key);
    else refused.push(key);
  }

  return { granted, refused };
}
