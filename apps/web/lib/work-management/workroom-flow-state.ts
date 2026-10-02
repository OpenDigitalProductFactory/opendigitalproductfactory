/**
 * Where a Workroom's time goes (BI-2A3C63FA, EP-B70E718D).
 *
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §5.
 *
 * The drive records a row every time a room's state changes (quiet ticks are
 * skipped). Each row carries the drive's action and reason. This module turns
 * that pair into one flow state, so process time, wait time and blockage can be
 * measured from the log the drive already writes, with no second vocabulary.
 *
 * TOTAL BY CONSTRUCTION. The table below is typed over the drive's reason
 * vocabulary of record (`DRIVE_REASONS_BY_ACTION`). A reason the drive starts
 * emitting is a compile error here until someone decides which state it is.
 *
 * `awaiting-trigger` is not waiting work. A standing room that finished its
 * cycle, or was asked not to interrupt, has no demand in hand; counting that gap
 * as wait would push every standing room's flow efficiency to zero and make the
 * measure noise (§5.3).
 *
 * Pure and synchronous.
 */
import type { DriveReasonFor, DriveReasonsByAction } from "./drive-conclusion";

export const WORKROOM_FLOW_STATES = [
  "working",
  "awaiting-person",
  "blocked",
  "awaiting-trigger",
  "done",
] as const;
export type WorkroomFlowState = (typeof WORKROOM_FLOW_STATES)[number];

type FlowStateTable = {
  [A in keyof DriveReasonsByAction]: Record<DriveReasonFor<A>, WorkroomFlowState>;
};

const FLOW_STATE_BY_ACTION_AND_REASON: FlowStateTable = {
  do_not_wake: {
    missing_shape: "blocked",
    no_posture: "blocked",
    quiet: "awaiting-trigger",
    cycle_complete: "awaiting-trigger",
  },
  stop: {
    unreachable_substrate: "blocked",
    // The substrate answered with nothing to do. There is no item waiting, so
    // this is absence of demand, not time an item spends in the stream.
    empty_read: "awaiting-trigger",
    conformance_stop: "blocked",
    success: "done",
  },
  escalate: {
    conformance_escalate: "blocked",
  },
  pause: {
    conformance_pause: "blocked",
    unknown_principal: "blocked",
    executor_writeback_unavailable: "blocked",
  },
  attention: {
    governed_decision: "awaiting-person",
    role_stage: "awaiting-person",
    person_stage: "awaiting-person",
  },
  dispatch_agent: {
    agent_stage: "working",
    // Another worker holds the stage; the stage is being worked.
    lease_held: "working",
    missing_task_owner: "blocked",
  },
};

export type WorkroomFlowClassification = {
  state: WorkroomFlowState;
  /** The drive reason when the state is `blocked`, so a pile can say why. */
  cause: string | null;
};

/**
 * Classify one drive row. Takes plain strings because rows come back from the
 * activity log; returns null for a pair the drive vocabulary does not contain,
 * so a caller counts it as unclassified rather than guessing.
 */
export function classifyDriveSegment(input: {
  action: string;
  reason: string;
}): WorkroomFlowClassification | null {
  const byReason = (FLOW_STATE_BY_ACTION_AND_REASON as Record<string, Record<string, WorkroomFlowState> | undefined>)[
    input.action
  ];
  const state = byReason && Object.hasOwn(byReason, input.reason) ? byReason[input.reason] : undefined;
  if (!state) return null;
  return { state, cause: state === "blocked" ? input.reason : null };
}

/** Time in this state counts toward flow time (§5.2). */
export function countsTowardFlowTime(state: WorkroomFlowState): boolean {
  return state === "working" || state === "awaiting-person" || state === "blocked";
}
