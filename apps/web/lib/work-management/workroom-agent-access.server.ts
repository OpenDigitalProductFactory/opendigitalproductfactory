import { prisma, type Prisma } from "@dpf/db";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { authorizeWorkroomAccess, type WorkroomAccessDecision, type WorkroomAccessLevel } from "./room-participation";
import { resolveRoomSensitivityCeiling } from "./room-sensitivity-ceiling.server";
import { readWorkspaceRoomPolicy } from "./workspace-room-access";

const principalSelect = { id: true, principalId: true, kind: true, status: true, sensitivityClearance: true } as const;
/** Why an owner-requested handover was refused, for a person admitted to the room. */
export type HandoverRefusal = "not-owner" | "assistant-in-room";
const denied: WorkroomAccessDecision = { level: "none", reason: "not-admitted" };
type Principal = { id: string; principalId: string; kind: string; status: string; sensitivityClearance: string[] };
type Membership = { principalId: string; lifecycle: string; roles: string[]; principal?: { kind: string } | null };

/** Persisted narrowing/removal wins over historical creation and lease fields. */
function admitted(principal: Principal, participants: Membership[], holders: (string | null)[], action: boolean) {
  const participant = participants.find((row) => row.principalId === principal.id);
  if (!participant) return holders.includes(principal.id);
  if (participant.lifecycle !== "active") return false;
  return !action || participant.roles.some((role) => ["accountable", "coordinator", "contributor", "specialist", "approver", "reviewer"].includes(role));
}

const OWNER_ROLES = ["coordinator", "accountable"];
const owns = (row: Membership) => row.lifecycle === "active" && row.roles.some((role) => OWNER_ROLES.includes(role));

/**
 * Whether a person owns a room: they oversee it, or (for a room no other
 * person oversees) they created, requested, or hold it. An AI coworker
 * appointed to coordinate acts for people and never displaces them
 * (BI-A27B903D).
 */
export function ownsRoom(principal: Principal, participants: Membership[], holders: (string | null)[]) {
  const row = participants.find((entry) => entry.principalId === principal.id);
  if (row) return owns(row);
  return !participants.some((entry) => owns(entry) && entry.principal?.kind !== "agent") && holders.includes(principal.id);
}

/**
 * Exact-room access; the case-wide messaging resolver cannot authorize sibling rooms.
 *
 * `handover` asks whether a person who owns the room may hand it to this
 * assistant (BI-821EEB18). Only an assistant nobody has admitted, narrowed, or
 * removed qualifies; case policy and clearance still apply to it.
 */
export async function resolveAgentWorkroomAccess(input: {
  userId: string; agentId: string; workroomId: string;
  requested: Exclude<WorkroomAccessLevel, "none">;
  handover?: boolean;
}, db: Prisma.TransactionClient = prisma): Promise<WorkroomAccessResult> {
  if (!input.agentId?.trim()) return { agentPrincipalId: null, decision: denied };
  return resolveActingWorkroomAccess(input, db);
}

/** Browser reads use the same admission and clearance policy, for the actual person. */
export async function resolveHumanWorkroomAccess(input: {
  userId: string; workroomId: string; requested: Exclude<WorkroomAccessLevel, "none">;
}, db: Prisma.TransactionClient = prisma): Promise<WorkroomAccessResult> {
  return resolveActingWorkroomAccess(input, db);
}

const roomSelect = {
  createdByPrincipalId: true, requestedByPrincipalId: true, leaseHolderPrincipalId: true, scopeClaims: true, backlogItemId: true,
  participants: { select: { principalId: true, lifecycle: true, roles: true, principal: { select: { kind: true } } } },
  workItem: { select: { evidence: true } },
} as const;
type Room = Prisma.WorkroomGetPayload<{ select: typeof roomSelect }>;
/** With a user context, principalId identifies that human; the assistant has its own agentId. */
export type CanonicalWorkroomActor = { userId: string | null; agentId: string | null; principalId: string | null };
export type WorkroomAuthorityContext = {
  humanPrincipal: Principal | null;
  agentPrincipal: Principal | null;
  room: Room;
  sensitivityCeiling: string | null;
};
export type WorkroomAccessResult = {
  decision: WorkroomAccessDecision;
  agentPrincipalId: string | null;
  handover?: boolean;
  handoverRefusal?: HandoverRefusal;
  authorityContext?: WorkroomAuthorityContext;
};

/** Internal actors retain their actual identity; no human or administrator is fabricated.
 * The caller still owns its tool grants and transaction/locking boundary. */
export async function resolveCanonicalWorkroomActorAccess(input: {
  actor: CanonicalWorkroomActor; workroomId: string;
  requested: Exclude<WorkroomAccessLevel, "none">;
}, db: Prisma.TransactionClient = prisma): Promise<WorkroomAccessResult> {
  if (input.actor.userId) {
    return resolveActingWorkroomAccess({ userId: input.actor.userId, expectedHumanPrincipalId: input.actor.principalId,
      ...(input.actor.agentId ? { agentId: input.actor.agentId } : {}),
      workroomId: input.workroomId, requested: input.requested }, db);
  }
  let principal: Principal | null = null;
  if (input.actor.agentId) {
    const [alias, agent] = await Promise.all([
      db.principalAlias.findFirst({ where: { aliasType: "agent", aliasValue: input.actor.agentId, issuer: "" }, select: { principal: { select: principalSelect } } }),
      db.agent.findUnique({ where: { agentId: input.actor.agentId }, select: { status: true, archived: true } }),
    ]);
    if (!agent || agent.status !== "active" || agent.archived || alias?.principal.kind !== "agent") return { decision: denied, agentPrincipalId: null };
    principal = alias.principal;
    if (input.actor.principalId && ![principal.id, principal.principalId].includes(input.actor.principalId)) return { decision: denied, agentPrincipalId: null };
  } else if (input.actor.principalId) {
    const matches = await db.principal.findMany({ where: { OR: [{ id: input.actor.principalId }, { principalId: input.actor.principalId }] }, select: principalSelect, take: 2 });
    if (matches.length !== 1 || !["service", "system"].includes(matches[0]!.kind)) return { decision: denied, agentPrincipalId: null };
    principal = matches[0]!;
  }
  if (!principal || principal.status !== "active") return { decision: denied, agentPrincipalId: null };
  const room = await db.workroom.findUnique({ where: { id: input.workroomId }, select: roomSelect });
  if (!room) return { decision: denied, agentPrincipalId: null };
  const ceiling = await resolveRoomSensitivityCeiling(room, db);
  return { decision: principalRoomAccess(principal, room, input.requested, ceiling),
    agentPrincipalId: principal.kind === "agent" ? principal.principalId : null,
    authorityContext: { humanPrincipal: null, agentPrincipal: principal, room, sensitivityCeiling: ceiling } };
}

/** One admission/clearance predicate for humans, paired assistants and internal actors. */
function principalRoomAccess(principal: Principal, room: Room, requested: Exclude<WorkroomAccessLevel, "none">,
  ceiling: string | null, handedOver = false): WorkroomAccessDecision {
  const holders = [room.createdByPrincipalId, room.requestedByPrincipalId, room.leaseHolderPrincipalId];
  if (!handedOver && !admitted(principal, room.participants, holders, requested === "action")) return denied;
  const policy = readWorkspaceRoomPolicy(room.workItem?.evidence);
  const policyRefs = requested === "action" ? policy.actionPrincipalRefs ?? policy.admittedPrincipalRefs
    : policy.admittedPrincipalRefs || policy.actionPrincipalRefs
      ? [...(policy.admittedPrincipalRefs ?? []), ...(policy.actionPrincipalRefs ?? [])] : undefined;
  if (policyRefs && !policyRefs.includes(principal.principalId)) return denied;
  for (const sensitivityCeiling of [ceiling, ...(policy.sensitivityCeiling ? [policy.sensitivityCeiling] : [])]) {
    const decision = authorizeWorkroomAccess({ requested, principalRef: principal.principalId,
      assignedPrincipalRefs: [principal.principalId], sensitivityCeiling,
      sensitivityClearance: principal.sensitivityClearance, isSuperuser: false,
      principalKind: principal.kind === "human" ? "human" : "agent" });
    if (decision.level !== requested) return decision;
  }
  return { level: requested, reason: "authorized" };
}

async function resolveActingWorkroomAccess(input: {
  userId: string; agentId?: string; workroomId: string; expectedHumanPrincipalId?: string | null;
  requested: Exclude<WorkroomAccessLevel, "none">; handover?: boolean;
}, db: Prisma.TransactionClient): Promise<WorkroomAccessResult> {
  const fail = (agentPrincipalId: string | null = null, decision = denied) => ({ decision, agentPrincipalId });
  if (!await currentUserContext(input.userId, db)) return fail();
  const [humanAlias, agentAlias, agent, room] = await Promise.all([
    db.principalAlias.findFirst({ where: { aliasType: "user", aliasValue: input.userId, issuer: "" }, select: { principal: { select: principalSelect } } }),
    input.agentId ? db.principalAlias.findFirst({ where: { aliasType: "agent", aliasValue: input.agentId, issuer: "" }, select: { principal: { select: principalSelect } } }) : Promise.resolve(null),
    input.agentId ? db.agent.findUnique({ where: { agentId: input.agentId }, select: { status: true, archived: true } }) : Promise.resolve(null),
    db.workroom.findUnique({ where: { id: input.workroomId }, select: roomSelect }),
  ]);
  const human = humanAlias?.principal;
  const assistant = agentAlias?.principal;
  if (!room || !human || human.kind !== "human" || human.status !== "active"
    || (input.expectedHumanPrincipalId != null && ![human.id, human.principalId].includes(input.expectedHumanPrincipalId))
    || (input.agentId && (!assistant || assistant.kind !== "agent" || assistant.status !== "active"
      || !agent || agent.status !== "active" || agent.archived))) return fail();
  const holders = [room.createdByPrincipalId, room.requestedByPrincipalId, room.leaseHolderPrincipalId];
  const ceiling = await resolveRoomSensitivityCeiling(room, db);
  const askedHandover = Boolean(assistant) && input.handover === true && input.requested === "action";
  const assistantInRoom = assistant ? room.participants.some((row) => row.principalId === assistant.id) : false;
  const handover = askedHandover && !assistantInRoom && ownsRoom(human, room.participants, holders);
  const handoverRefusal: HandoverRefusal | null = askedHandover && !handover && admitted(human, room.participants, holders, false)
    ? (assistantInRoom ? "assistant-in-room" : "not-owner") : null;
  for (const principal of assistant ? [human, assistant] : [human]) {
    const handedOver = handover && principal === assistant;
    const decision = principalRoomAccess(principal, room, input.requested, ceiling, handedOver);
    if (decision.level !== input.requested) {
      // Preserve the existing refusal disclosure only for an admission failure.
      const discloseRefusal = handoverRefusal && !handedOver && !admitted(principal, room.participants, holders, input.requested === "action");
      return { ...fail(assistant?.principalId ?? null, decision), ...(discloseRefusal ? { handoverRefusal } : {}) };
    }
  }
  return { agentPrincipalId: assistant?.principalId ?? null, decision: { level: input.requested, reason: "authorized" } as WorkroomAccessDecision, handover,
    authorityContext: { humanPrincipal: human, agentPrincipal: assistant ?? null, room, sensitivityCeiling: ceiling } };
}
