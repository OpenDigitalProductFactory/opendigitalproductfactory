import { prisma, type Prisma } from "@dpf/db";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { authorizeWorkroomAccess, type WorkroomAccessDecision, type WorkroomAccessLevel } from "./room-participation";
import { readWorkroomBoundaryClaim } from "./workroom-boundary-claim";
import { readWorkspaceRoomPolicy } from "./workspace-room-access";

const principalSelect = { id: true, principalId: true, kind: true, status: true, sensitivityClearance: true } as const;
const denied: WorkroomAccessDecision = { level: "none", reason: "not-admitted" };
type Principal = { id: string; principalId: string; sensitivityClearance: string[] };
type Membership = { principalId: string; lifecycle: string; roles: string[] };

/** Persisted narrowing/removal wins over historical creation and lease fields. */
function admitted(principal: Principal, participants: Membership[], holders: (string | null)[], action: boolean) {
  const participant = participants.find((row) => row.principalId === principal.id);
  if (!participant) return holders.includes(principal.id);
  if (participant.lifecycle !== "active") return false;
  return !action || participant.roles.some((role) => ["accountable", "coordinator", "contributor", "specialist", "approver", "reviewer"].includes(role));
}

/** Exact-room access; the case-wide messaging resolver cannot authorize sibling rooms. */
export async function resolveAgentWorkroomAccess(input: {
  userId: string; agentId: string; workroomId: string;
  requested: Exclude<WorkroomAccessLevel, "none">;
}, db: Prisma.TransactionClient = prisma) {
  const fail = (agentPrincipalId: string | null = null, decision = denied) => ({ decision, agentPrincipalId });
  if (!await currentUserContext(input.userId, db)) return fail();
  const [humanAlias, agentAlias, agent, room] = await Promise.all([
    db.principalAlias.findFirst({ where: { aliasType: "user", aliasValue: input.userId, issuer: "" }, select: { principal: { select: principalSelect } } }),
    db.principalAlias.findFirst({ where: { aliasType: "agent", aliasValue: input.agentId, issuer: "" }, select: { principal: { select: principalSelect } } }),
    db.agent.findUnique({ where: { agentId: input.agentId }, select: { status: true, archived: true } }),
    db.workroom.findUnique({ where: { id: input.workroomId }, select: {
      createdByPrincipalId: true, requestedByPrincipalId: true, leaseHolderPrincipalId: true, scopeClaims: true,
      participants: { select: { principalId: true, lifecycle: true, roles: true } },
      workItem: { select: { evidence: true } },
    } }),
  ]);
  const human = humanAlias?.principal;
  const assistant = agentAlias?.principal;
  if (!room || !human || human.kind !== "human" || human.status !== "active"
    || !assistant || assistant.kind !== "agent" || assistant.status !== "active"
    || !agent || agent.status !== "active" || agent.archived) return fail();
  const holders = [room.createdByPrincipalId, room.requestedByPrincipalId, room.leaseHolderPrincipalId];
  const policy = readWorkspaceRoomPolicy(room.workItem?.evidence);
  const ceiling = readWorkroomBoundaryClaim(room.scopeClaims)?.sensitivityCeiling ?? "internal";
  for (const principal of [human, assistant]) {
    if (!admitted(principal, room.participants, holders, input.requested === "action")) return fail(assistant.principalId);
    // An explicit case policy restricts admission; it never supplies a room invitation.
    const policyRefs = input.requested === "action" ? policy.actionPrincipalRefs
      : policy.admittedPrincipalRefs || policy.actionPrincipalRefs
        ? [...(policy.admittedPrincipalRefs ?? []), ...(policy.actionPrincipalRefs ?? [])] : undefined;
    if (policyRefs && !policyRefs.includes(principal.principalId)) return fail(assistant.principalId);
    for (const sensitivityCeiling of [ceiling, ...(policy.sensitivityCeiling ? [policy.sensitivityCeiling] : [])]) {
      const decision = authorizeWorkroomAccess({ requested: input.requested, principalRef: principal.principalId,
        assignedPrincipalRefs: [principal.principalId], sensitivityCeiling,
        sensitivityClearance: principal.sensitivityClearance, isSuperuser: false, principalKind: principal.kind === "human" ? "human" : "agent" });
      if (decision.level !== input.requested) return fail(assistant.principalId, decision);
    }
  }
  return { agentPrincipalId: assistant.principalId, decision: { level: input.requested, reason: "authorized" } as WorkroomAccessDecision };
}
