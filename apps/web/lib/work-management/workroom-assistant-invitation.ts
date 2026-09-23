import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { resolveOAuthConsent } from "@/lib/auth/oauth-identity-binding";
import { authorizeWorkroomAccess } from "./room-participation";
import { persistWorkroomParticipantAssignment } from "./room-participant-assignment.server";
import { readWorkroomBoundaryClaim } from "./workroom-boundary-claim";
import { readWorkspaceRoomPolicy } from "./workspace-room-access";

export class WorkroomAssistantInvitationError extends Error {}
export type WorkroomAssistantInvitation = { workroomId: string; agentId: string; role: "observer" | "contributor" };
export type WorkroomAssistantChoice = { agentId: string; name: string; role: WorkroomAssistantInvitation["role"] | null };
const principalSelect = { id: true, principalId: true, kind: true, status: true, sensitivityClearance: true } as const;

async function ownerRoom(userId: string, workroomId: string, db: Prisma.TransactionClient) {
  const denied = () => new WorkroomAssistantInvitationError("Only an active room owner can manage assistant access.");
  if (!await currentUserContext(userId, db)) throw denied();
  const [alias, room] = await Promise.all([
    db.principalAlias.findFirst({ where: { aliasType: "user", aliasValue: userId, issuer: "" }, select: { principal: { select: principalSelect } } }),
    db.workroom.findUnique({ where: { id: workroomId }, select: {
      id: true, capsuleId: true, requestedByPrincipalId: true, createdByPrincipalId: true, leaseHolderPrincipalId: true, scopeClaims: true,
      participants: { select: { principalId: true, lifecycle: true, roles: true } }, workItem: { select: { evidence: true } },
    } }),
  ]);
  const human = alias?.principal;
  if (!room || !human || human.kind !== "human" || human.status !== "active"
    || ![room.requestedByPrincipalId, room.createdByPrincipalId, room.leaseHolderPrincipalId].includes(human.id)) throw denied();
  const membership = room.participants.find((row) => row.principalId === human.id);
  if (membership && (membership.lifecycle !== "active" || !membership.roles.some((role) => role !== "observer"))) throw denied();
  const policy = readWorkspaceRoomPolicy(room.workItem?.evidence);
  const policyRefs = policy.actionPrincipalRefs ?? policy.admittedPrincipalRefs;
  if (policyRefs && !policyRefs.includes(human.principalId)) throw denied();
  for (const sensitivityCeiling of [readWorkroomBoundaryClaim(room.scopeClaims)?.sensitivityCeiling ?? "internal", ...(policy.sensitivityCeiling ? [policy.sensitivityCeiling] : [])]) {
    const access = authorizeWorkroomAccess({ requested: "action", principalRef: human.principalId,
      assignedPrincipalRefs: [human.principalId], sensitivityCeiling, sensitivityClearance: human.sensitivityClearance,
      isSuperuser: false, principalKind: "human" });
    if (access.level !== "action") throw new WorkroomAssistantInvitationError("You need access to this room's information before inviting an assistant.");
  }
  return room;
}

async function approvedAssistants(userId: string, db: Prisma.TransactionClient) {
  const bindings = await db.authorityBinding.findMany({
    where: { oauthUserId: userId, oauthPurpose: "consent", status: "active", oauthClient: { revokedAt: null }, appliedAgent: { status: "active", archived: false } },
    select: { id: true, oauthClientId: true, resourceRef: true, grants: { select: { grantKey: true, mode: true } }, appliedAgent: { select: { agentId: true, displayName: true } } },
    orderBy: { createdAt: "desc" },
  });
  const choices = new Map<string, { agentId: string; name: string }>();
  for (const binding of bindings) {
    if (!binding.oauthClientId || !binding.appliedAgent || choices.has(binding.appliedAgent.agentId)) continue;
    const consent = await resolveOAuthConsent({ bindingId: binding.id, userId, clientId: binding.oauthClientId,
      resource: binding.resourceRef, scopes: binding.grants.filter((grant) => grant.mode === "allow").map((grant) => grant.grantKey) }, db);
    if (consent) choices.set(consent.agentId, { agentId: consent.agentId, name: binding.appliedAgent.displayName });
  }
  return [...choices.values()];
}

export async function listWorkroomAssistantChoices(userId: string, workroomId: string) {
  const room = await ownerRoom(userId, workroomId, prisma);
  const choices: WorkroomAssistantChoice[] = [];
  for (const choice of await approvedAssistants(userId, prisma)) {
    const alias = await prisma.principalAlias.findFirst({ where: { aliasType: "agent", aliasValue: choice.agentId, issuer: "" }, select: { principal: { select: principalSelect } } });
    if (alias?.principal.kind !== "agent" || alias.principal.status !== "active") continue;
    const membership = room.participants.find((row) => row.principalId === alias.principal.id && row.lifecycle === "active");
    if (membership?.roles.some((role) => !["observer", "contributor"].includes(role))) continue;
    choices.push({ ...choice, role: membership ? membership.roles.includes("contributor") ? "contributor" : "observer" : null });
  }
  return choices;
}

/** A human invitation changes only one room, never the connection or case policy. */
export async function inviteWorkroomAssistant(userId: string, input: WorkroomAssistantInvitation) {
  if (!input || !input.workroomId || !input.agentId || !["observer", "contributor"].includes(input.role)) {
    throw new WorkroomAssistantInvitationError("Choose an assistant and Read only or Contribute access.");
  }
  return prisma.$transaction(async (db) => {
    const room = await ownerRoom(userId, input.workroomId, db);
    if (!(await approvedAssistants(userId, db)).some((choice) => choice.agentId === input.agentId)) {
      throw new WorkroomAssistantInvitationError("Choose an assistant from your approved connections.");
    }
    const alias = await db.principalAlias.findFirst({ where: { aliasType: "agent", aliasValue: input.agentId, issuer: "" }, select: { principal: { select: principalSelect } } });
    const assistant = alias?.principal;
    if (!assistant || assistant.kind !== "agent" || assistant.status !== "active") {
      throw new WorkroomAssistantInvitationError("Choose an active assistant with an approved identity.");
    }
    const before = room.participants.find((row) => row.principalId === assistant.id);
    if (before?.lifecycle === "active" && before.roles.some((role) => !["observer", "contributor"].includes(role))) {
      throw new WorkroomAssistantInvitationError("This assistant has an assigned role. Ask the room coordinator to change it.");
    }
    const saved = await persistWorkroomParticipantAssignment({ workroomId: room.id, principalRef: assistant.principalId,
      roles: [input.role], assignmentSource: "explicit", enteredReason: "Invited by the room owner from an approved assistant connection", currentWorkSummary: null }, db);
    if (!saved) throw new WorkroomAssistantInvitationError("The assistant's access changed. Refresh and try again.");
    await db.authorizationDecisionLog.create({ data: {
      decisionId: `ADL-${randomUUID()}`, actorType: "human", actorRef: userId, humanContextRef: userId,
      agentContextRef: input.agentId, actionKey: "workroom-assistant-invitation", objectRef: room.capsuleId, decision: "allow",
      rationale: { workroomId: room.id, principalId: assistant.id,
        before: before ? { lifecycle: before.lifecycle, roles: before.roles } : null,
        after: { lifecycle: "active", roles: [input.role] } },
      routeContext: "/workspace",
    } });
    return { agentId: input.agentId, role: input.role };
  }, { isolationLevel: "Serializable" });
}
