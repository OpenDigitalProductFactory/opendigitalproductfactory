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
// drive's repair of rooms created before this rule existed. A handover
// (reassign_workroom_executor, BI-821EEB18) admits the new assistant alone.
//
// It never overrides a decision someone made: an existing coordinator stays,
// and a participant who was removed is not re-admitted.
//
// It never makes an account whose work was handed over (User.workHandedOverAt,
// BI-858FDE5A) the owner of a new room (BI-C66B6076). On 2026-10-02 Codex
// signed in as admin@dpf.local, a day after that account's work was handed
// over, and the adopted room WC-BBA7AEBB was born owned by it. The room goes to
// its accountable person instead, by the rule the handover itself used
// (resolveWorkOwner: the room's portfolio, Foundational, the organization).
// When only the install fallback could be named, nobody is appointed and the
// trail says why. The assistant acting for the claim is still admitted.

import { resolveWorkOwner, type AccountableOwnerDb, type WorkOwnerSource } from "@/lib/portfolio/accountable-owner";
import { isPortfolioRole, PORTFOLIO_SLUG_BY_ROLE } from "@/lib/portfolio/portfolio-role";

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
  /** Read to keep a handed-over account from owning the room. */
  workroom: { findUnique(args: unknown): Promise<{ portfolioRole: string | null } | null> };
  principalAlias: { findFirst(args: unknown): Promise<{ aliasValue?: string; principalId?: string } | null> };
  user: { findFirst(args: unknown): Promise<{ id: string; workHandedOverAt?: Date | null } | null> };
  portfolio: Pick<AccountableOwnerDb["portfolio"], "findUnique">;
  organization: AccountableOwnerDb["organization"];
};

export type RoomOwnershipOutcome = {
  coordinatorPrincipalId: string | null;
  ownerAppointed: boolean;
  assistantAdmitted: boolean;
  /** Why an expected write was skipped, in plain words, for the activity trail. */
  skipped: string[];
  /** The handed-over account the claim resolved to, when the room went to someone else. */
  reroutedFromPrincipalId?: string;
  /** Where the substitute owner came from (resolveWorkOwner). */
  ownerSource?: WorkOwnerSource;
};

const HANDED_OVER_UNOWNED =
  "The account this work was claimed under had its work handed over, and no accountable person is recorded for this room's portfolio, Foundational or the organization, so nobody was appointed.";

type OwnerRouting =
  | { state: "unchanged" }
  | { state: "rerouted"; ownerPrincipalId: string; source: WorkOwnerSource }
  | { state: "unowned" };

/**
 * When the owner's account was handed over, the room's accountable person, or
 * nobody. Never the install fallback and never the account being left.
 */
async function routeAwayFromHandedOverAccount(
  db: RoomOwnershipDb,
  workroomId: string,
  ownerPrincipalId: string,
): Promise<OwnerRouting> {
  const alias = await db.principalAlias.findFirst({
    where: { principalId: ownerPrincipalId, aliasType: "user" },
    select: { aliasValue: true },
  });
  if (!alias?.aliasValue) return { state: "unchanged" };
  const handedOver = await db.user.findFirst({
    where: { id: alias.aliasValue, workHandedOverAt: { not: null } },
    select: { id: true, workHandedOverAt: true },
  });
  if (!handedOver) return { state: "unchanged" };

  const room = await db.workroom.findUnique({ where: { id: workroomId }, select: { portfolioRole: true } });
  const slug = room?.portfolioRole && isPortfolioRole(room.portfolioRole) ? PORTFOLIO_SLUG_BY_ROLE[room.portfolioRole] : null;
  const portfolio = slug
    ? await db.portfolio.findUnique({ where: { slug }, select: { id: true, slug: true, accountablePrincipalId: true } })
    : null;
  // resolveWorkOwner throws only when the install has no active superuser at
  // all; a claim must not fail on that, the room is simply left unowned.
  const owner = await resolveWorkOwner(db as never, { portfolioId: portfolio?.id ?? null }).catch(() => null);
  if (!owner || owner.source === "fallback" || owner.userId === handedOver.id) return { state: "unowned" };
  const principal = await db.principalAlias.findFirst({
    where: { aliasType: "user", aliasValue: owner.userId, principal: { kind: "human", status: "active" } },
    select: { principalId: true },
  });
  if (!principal?.principalId) return { state: "unowned" };
  return { state: "rerouted", ownerPrincipalId: principal.principalId, source: owner.source };
}

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

  let owner = input.ownerPrincipalId;
  if (owner && coordinators.length === 0) {
    const routing = await routeAwayFromHandedOverAccount(db, input.workroomId, owner);
    if (routing.state !== "unchanged") outcome.reroutedFromPrincipalId = owner;
    if (routing.state === "rerouted") {
      owner = routing.ownerPrincipalId;
      outcome.ownerSource = routing.source;
    } else if (routing.state === "unowned") {
      owner = null;
      outcome.skipped.push(HANDED_OVER_UNOWNED);
    }
  }
  if (!owner) {
    if (!outcome.reroutedFromPrincipalId) outcome.skipped.push("No person could be resolved as the room's owner.");
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
  if (assistant && assistant !== owner && assistant !== outcome.reroutedFromPrincipalId) {
    const admission = await admitRoomAssistant(db, input.workroomId, assistant, byPrincipal.get(assistant) ?? null);
    outcome.assistantAdmitted = admission.admitted;
    if (admission.skipped) outcome.skipped.push(admission.skipped);
  }
  return outcome;
}

/**
 * Admit an assistant to one room as a contributor. A participant already in the
 * room keeps the roles someone gave it, and one who was removed stays removed.
 * Pass `existing` when the roster is already loaded.
 */
export async function admitRoomAssistant(
  db: Pick<RoomOwnershipDb, "workroomParticipant">,
  workroomId: string,
  assistantPrincipalId: string,
  existing?: ParticipantRow | null,
): Promise<{ admitted: boolean; skipped: string | null }> {
  const row = existing !== undefined ? existing : (await db.workroomParticipant.findMany({
    where: { workroomId, principalId: assistantPrincipalId },
    select: { id: true, principalId: true, roles: true, lifecycle: true },
  }))[0] ?? null;
  if (row && !isActive(row)) {
    return { admitted: false, skipped: "The assistant was removed from this room earlier, so it was not re-admitted." };
  }
  if (row) return { admitted: false, skipped: null };
  await db.workroomParticipant.create({
    data: {
      workroomId,
      principalId: assistantPrincipalId,
      roles: ["contributor"],
      assignmentSource: "explicit",
      enteredReason: ROOM_ASSISTANT_REASON,
      lifecycle: "active",
    },
  });
  return { admitted: true, skipped: null };
}

/** One sentence for the room's activity trail, or null when nothing changed. */
export function describeRoomOwnership(outcome: RoomOwnershipOutcome): string | null {
  const sentences: string[] = [];
  if (outcome.ownerAppointed && outcome.reroutedFromPrincipalId) {
    sentences.push(
      outcome.assistantAdmitted
        ? "The account this work was claimed under had its work handed over, so the room's accountable person owns it, and the assistant was admitted."
        : "The account this work was claimed under had its work handed over, so the room's accountable person owns it.",
    );
  } else if (outcome.ownerAppointed && outcome.assistantAdmitted) {
    sentences.push("The person this work is for now owns the room, and their assistant was admitted.");
  } else if (outcome.ownerAppointed) {
    sentences.push("The person this work is for now owns the room.");
  } else if (outcome.assistantAdmitted) {
    sentences.push("The owner's assistant was admitted to the room.");
  }
  sentences.push(...outcome.skipped);
  return sentences.length > 0 ? sentences.join(" ") : null;
}
