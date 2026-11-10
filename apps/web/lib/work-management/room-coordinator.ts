/**
 * Work Room Coordinator — the first-class role that keeps a room on-task to its
 * outcome (admit/curate members, sequence turns, drive to verdict/close/escalate).
 *
 * EP-WORKROOM-COMMS (BI-5A7BC4B3). Distinct from `accountable` (who owns the
 * outcome): a room has exactly one active Coordinator, which may be the same
 * principal as the accountable or a different one (e.g. an accountable human who
 * delegates coordination to a facilitator coworker). Maps to DACI "Driver".
 *
 * Pure module: no DB, no imports beyond the participant view type.
 *
 * Design of record: docs/superpowers/specs/2026-08-12-work-room-multi-agent-communication-substrate-design.md §2
 */
import type { WorkroomParticipantView } from "./room-types";

export type WorkroomParticipantErrorReason = "multiple_active_coordinators";

export class WorkroomParticipantError extends Error {
  constructor(readonly reason: WorkroomParticipantErrorReason, message: string) {
    super(message);
    this.name = "WorkroomParticipantError";
  }
}

function isCoordinator(participant: WorkroomParticipantView): boolean {
  return participant.roles.includes("coordinator");
}

function isAccountable(participant: WorkroomParticipantView): boolean {
  return participant.roles.includes("accountable");
}

/**
 * Resolve the single active Coordinator, or null if the room has none yet.
 * Mirrors the single-active-cycle invariant: a room may name at most one
 * Coordinator; more than one is a defect, not a merge.
 */
export function selectRoomCoordinator(
  participants: readonly WorkroomParticipantView[],
): WorkroomParticipantView | null {
  const coordinators = participants.filter(isCoordinator);
  if (coordinators.length > 1) {
    throw new WorkroomParticipantError(
      "multiple_active_coordinators",
      "A Work Room can have only one active Coordinator.",
    );
  }
  return coordinators[0] ?? null;
}

/**
 * Coordinator that was persisted as an assignment. A derived coordinator may
 * explain an old room but does not qualify it for autonomous execution.
 */
export function selectExplicitRoomCoordinator(
  participants: readonly WorkroomParticipantView[],
): WorkroomParticipantView | null {
  const coordinator = selectRoomCoordinator(participants);
  return coordinator?.coordinatorSource === "explicit" ? coordinator : null;
}

/**
 * Ensure the room has a Coordinator. If one is already named (by policy or
 * lineage) it is kept; otherwise the accountable principal coordinates by
 * default — the Coordinator role is added to the (single) accountable
 * participant, keeping the role distinct while defaulting sensibly. A room with
 * no accountable and no named coordinator is left as-is (nothing to derive).
 *
 * Pure: returns a new array; participant objects are copied only when changed.
 */
export function deriveRoomCoordinator(
  participants: readonly WorkroomParticipantView[],
): WorkroomParticipantView[] {
  const named = selectRoomCoordinator(participants);
  if (named) {
    return participants.map((participant) =>
      isCoordinator(participant)
        ? {
            ...participant,
            coordinatorSource: participant.coordinatorSource === "derived" ? "derived" : "explicit",
          }
        : { ...participant, coordinatorSource: "none" },
    );
  }

  const accountable = participants.filter(isAccountable);
  // Only default when there is exactly one accountable to promote; ambiguous or
  // absent accountability leaves the room without a derived coordinator.
  if (accountable.length !== 1) {
    return participants.map((participant) => ({ ...participant, coordinatorSource: "none" }));
  }

  const target = accountable[0];
  return participants.map((participant) =>
    participant.principalRef === target.principalRef
      ? {
          ...participant,
          roles: [...new Set([...participant.roles, "coordinator" as const])],
          coordinatorSource: "derived",
        }
      : { ...participant, coordinatorSource: "none" },
  );
}
