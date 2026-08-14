/**
 * Work Room policy writer (EP-WORKROOM-COMMS, BI-8CD6E35F).
 *
 * The substrate READS an outcome-scoped `{ workRoomPolicy: {...} }` object off
 * WorkItem.evidence (workspace-room-access.readWorkspaceRoomPolicy, latest-wins)
 * but nothing WRITES it. This is the pure writer: given the current evidence and
 * an invitee, it returns a new evidence array with an appended policy snapshot
 * that admits the invitee — preserving the append/latest-wins contract rather
 * than clobbering prior evidence. Membership stays outcome-scoped per room.
 *
 * Pure module: no DB. Refs are canonical Principal.principalId (PRN).
 * Design of record: docs/superpowers/specs/2026-08-12-work-room-multi-agent-communication-substrate-design.md §1-§2
 */
import type { WorkRoomParticipantRole } from "./room-types";
import { readWorkspaceRoomPolicy } from "./workspace-room-access";

export interface RoomParticipantInvite {
  /** Canonical Principal.principalId (PRN) of the invitee. */
  principalRef: string;
  roles: WorkRoomParticipantRole[];
  /** Whether the invitee may act (post) in the room, not just read. */
  canAct: boolean;
  enteredReason?: string | null;
}

/**
 * Append a policy snapshot to the room's evidence that admits `invite`.
 * Returns the new evidence array (the caller persists it to WorkItem.evidence).
 */
export function appendRoomPolicyParticipant(evidence: unknown, invite: RoomParticipantInvite): unknown[] {
  const current = readWorkspaceRoomPolicy(evidence);

  const admitted = new Set([...(current.admittedPrincipalRefs ?? []), invite.principalRef]);
  const action = new Set(current.actionPrincipalRefs ?? []);
  if (invite.canAct) action.add(invite.principalRef);

  const roles = invite.roles.length > 0 ? invite.roles : (["observer"] as WorkRoomParticipantRole[]);
  const participants = [
    ...(current.participants ?? []).filter((participant) => participant.principalRef !== invite.principalRef),
    {
      principalRef: invite.principalRef,
      roles,
      enteredReason: invite.enteredReason ?? "Invited into the room",
      currentWorkSummary: null,
    },
  ];

  const mergedPolicy = {
    admittedPrincipalRefs: [...admitted],
    actionPrincipalRefs: [...action],
    discoverablePrincipalRefs: current.discoverablePrincipalRefs ?? [],
    sensitivityCeiling: current.sensitivityCeiling ?? "internal",
    participants,
  };

  const prior = Array.isArray(evidence) ? evidence : evidence ? [evidence] : [];
  return [...prior, { workRoomPolicy: mergedPolicy }];
}
