// A delivery Workroom is born owned (BI-36FC2981, BI-E8C78E80).
//
// Conformance refuses to drive a room without exactly one explicit Process
// Overseer, and nothing wrote one at birth: on 2026-09-23, 129 of 134 driven
// rooms sat paused on missing_explicit_coordinator. For delivery work the
// shape's driver is `role:author`, and the author of claimed work is the person
// the claim was made for. This module writes that person as the overseer and
// admits the assistant acting for them, in the same transaction as the claim.
//
// One rule, three callers: claim_backlog_item_for_work, adopt_worktree, and the
// drive's repair of rooms created before this rule existed.
//
// It never overrides a decision someone made: an existing coordinator stays,
// and a participant who was removed is not re-admitted.

export const ROOM_OWNERSHIP_REASON =
  "Owns the delivery work this room was claimed for (work shape role:author).";
export const ROOM_ASSISTANT_REASON = "Acts for the room's owner as their assistant.";

export type RoomOwnershipPrincipals = {
  /** Principal.id of the person the work is for. */
  ownerPrincipalId: string | null;
  /** Principal.id of the assistant acting for them, when one is. */
  assistantPrincipalId: string | null;
};

type ParticipantRow = {
  id: string;
  principalId: string;
  roles: string[];
  lifecycle: string;
};

export type RoomOwnershipDb = {
  workroomParticipant: {
    findMany(args: unknown): Promise<ParticipantRow[]>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
};

export type RoomOwnershipOutcome = {
  coordinatorPrincipalId: string | null;
  ownerAppointed: boolean;
  assistantAdmitted: boolean;
  /** Why an expected write was skipped, in plain words, for the activity trail. */
  skipped: string[];
};

/**
 * The person and assistant behind a Workroom actor.
 *
 * OAuth: `principalId` is the human and `agentPrincipalId` the assistant.
 * A token with no agent: `principalId` is the human. An agent acting without
 * OAuth: `principalId` is the agent, and the human comes from its user.
 */
export async function resolveRoomOwnershipPrincipals(
  actor: { userId: string; agentId: string | null; principalId: string | null; agentPrincipalId?: string },
  resolveUserPrincipalId: (userId: string) => Promise<string | null>,
): Promise<RoomOwnershipPrincipals> {
  if (actor.agentPrincipalId) {
    return { ownerPrincipalId: actor.principalId, assistantPrincipalId: actor.agentPrincipalId };
  }
  if (!actor.agentId) return { ownerPrincipalId: actor.principalId, assistantPrincipalId: null };
  return {
    ownerPrincipalId: await resolveUserPrincipalId(actor.userId),
    assistantPrincipalId: actor.principalId,
  };
}

const isActive = (row: ParticipantRow) => row.lifecycle === "active";

export async function establishRoomOwnership(
  db: RoomOwnershipDb,
  input: RoomOwnershipPrincipals & { workroomId: string },
): Promise<RoomOwnershipOutcome> {
  const rows = await db.workroomParticipant.findMany({
    where: { workroomId: input.workroomId },
    select: { id: true, principalId: true, roles: true, lifecycle: true },
  });
  const byPrincipal = new Map(rows.map((row) => [row.principalId, row]));
  const coordinators = rows.filter((row) => isActive(row) && row.roles.includes("coordinator"));
  const outcome: RoomOwnershipOutcome = {
    coordinatorPrincipalId: coordinators.length === 1 ? coordinators[0].principalId : null,
    ownerAppointed: false,
    assistantAdmitted: false,
    skipped: [],
  };

  const owner = input.ownerPrincipalId;
  if (!owner) {
    outcome.skipped.push("No person could be resolved as the room's owner.");
  } else if (coordinators.length > 0) {
    // Somebody already owns the room; that decision stands.
  } else {
    const existing = byPrincipal.get(owner);
    if (existing && !isActive(existing)) {
      outcome.skipped.push("The owner was removed from this room earlier, so they were not re-admitted.");
    } else if (existing) {
      await db.workroomParticipant.update({
        where: { id: existing.id },
        data: { roles: [...new Set([...existing.roles, "coordinator"])] },
      });
      outcome.ownerAppointed = true;
      outcome.coordinatorPrincipalId = owner;
    } else {
      await db.workroomParticipant.create({
        data: {
          workroomId: input.workroomId,
          principalId: owner,
          roles: ["coordinator"],
          assignmentSource: "explicit",
          enteredReason: ROOM_OWNERSHIP_REASON,
          lifecycle: "active",
        },
      });
      outcome.ownerAppointed = true;
      outcome.coordinatorPrincipalId = owner;
    }
  }

  const assistant = input.assistantPrincipalId;
  if (assistant && assistant !== owner) {
    const existing = byPrincipal.get(assistant);
    if (existing && !isActive(existing)) {
      outcome.skipped.push("The assistant was removed from this room earlier, so it was not re-admitted.");
    } else if (!existing) {
      await db.workroomParticipant.create({
        data: {
          workroomId: input.workroomId,
          principalId: assistant,
          roles: ["contributor"],
          assignmentSource: "explicit",
          enteredReason: ROOM_ASSISTANT_REASON,
          lifecycle: "active",
        },
      });
      outcome.assistantAdmitted = true;
    }
  }
  return outcome;
}

/** One sentence for the room's activity trail, or null when nothing changed. */
export function describeRoomOwnership(outcome: RoomOwnershipOutcome): string | null {
  const sentences: string[] = [];
  if (outcome.ownerAppointed && outcome.assistantAdmitted) {
    sentences.push("The person this work is for now owns the room, and their assistant was admitted.");
  } else if (outcome.ownerAppointed) {
    sentences.push("The person this work is for now owns the room.");
  } else if (outcome.assistantAdmitted) {
    sentences.push("The owner's assistant was admitted to the room.");
  }
  sentences.push(...outcome.skipped);
  return sentences.length > 0 ? sentences.join(" ") : null;
}
