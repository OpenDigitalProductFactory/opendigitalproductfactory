/**
 * Work Room policy writer (EP-WORKROOM-COMMS, BI-8CD6E35F).
 *
 * The substrate READS an outcome-scoped `{ workroomPolicy: {...} }` object off
 * WorkItem.evidence (workspace-room-access.readWorkspaceRoomPolicy, latest-wins)
 * but nothing WRITES it. This is the pure writer: given the current evidence and
 * an invitee, it returns a new evidence array with an appended policy snapshot
 * that admits the invitee — preserving the append/latest-wins contract rather
 * than clobbering prior evidence. Membership stays outcome-scoped per room.
 *
 * Pure module: no DB. Refs are canonical Principal.principalId (PRN).
 * Design of record: docs/superpowers/specs/2026-08-12-work-room-multi-agent-communication-substrate-design.md §1-§2
 */
import type { WorkroomParticipantRole } from "./room-types";
import { readWorkspaceRoomPolicy } from "./workspace-room-access";

export interface RoomParticipantInvite {
  /** Canonical Principal.principalId (PRN) of the invitee. */
  principalRef: string;
  roles: WorkroomParticipantRole[];
  /** Whether the invitee may act (post) in the room, not just read. */
  canAct: boolean;
  enteredReason?: string | null;
}

/** Someone already active in the room, and whether they may act there. */
export interface RoomMember {
  principalRef: string;
  canAct: boolean;
}

/**
 * Append a policy snapshot to the room's evidence that admits `invite`.
 * Returns the new evidence array (the caller persists it to WorkItem.evidence).
 *
 * Room access treats an explicit policy as a restriction, so a snapshot must
 * keep everyone already in the room. The first invite once wrote a policy
 * admitting only the invitee and locked the room's own coordinator and
 * assistant out (BI-16DA79C5). `members` are the room's current active members;
 * a member who has left is simply not passed, so an invite never re-admits them.
 */
export function appendRoomPolicyParticipant(
  evidence: unknown,
  invite: RoomParticipantInvite,
  members: readonly RoomMember[] = [],
): unknown[] {
  const current = readWorkspaceRoomPolicy(evidence);

  const admitted = new Set([...(current.admittedPrincipalRefs ?? []), ...members.map((m) => m.principalRef), invite.principalRef]);
  const action = new Set([...(current.actionPrincipalRefs ?? []), ...members.filter((m) => m.canAct).map((m) => m.principalRef)]);
  if (invite.canAct) action.add(invite.principalRef);

  const roles = invite.roles.length > 0 ? invite.roles : (["observer"] as WorkroomParticipantRole[]);
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
    // Carry only a ceiling someone set; the room derives its own (BI-0A5EE9C1).
    ...(current.sensitivityCeiling ? { sensitivityCeiling: current.sensitivityCeiling } : {}),
    participants,
  };

  const prior = Array.isArray(evidence) ? evidence : evidence ? [evidence] : [];
  return [...prior, { workroomPolicy: mergedPolicy }];
}
