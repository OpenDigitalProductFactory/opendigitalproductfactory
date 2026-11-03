import type { Prisma } from "@dpf/db";
import { APPROVED_EXTERNAL_ROLES } from "@/lib/auth/oauth-identity-binding";
import { ownsRoom, resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { readWorkspaceRoomPolicy } from "@/lib/work-management/workspace-room-access";
import { BoundedHandoffRefusal, handoffDigest, type BoundedHandoffRequest } from "./bounded-handoff-command";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

const EXTERNAL_SURFACES: Readonly<Record<string, string>> = {
  "AGT-EXT-CLAUDE": "claude-desktop", "AGT-EXT-CODEX": "codex-desktop", "AGT-EXT-GROK": "grok-desktop",
};
export type HandoffRoom = Record<string, unknown> & {
  id: string; capsuleId: string; executorKind: string | null; executorRef: string | null;
  leaseHolderPrincipalId: string | null; leaseExpiresAt: Date | null;
  featureBuildId: string | null; repositoryFullName: string | null; headSha: string | null; headBranch: string | null;
};
export type HandoffSnapshot = { digest: string; leaseExpiresAt: string; leaseHolderPrincipalId: string; executorKind: string; executorRef: string; boundary: Record<string, unknown> };
const fail = (code: string, message: string): never => { throw new BoundedHandoffRefusal(code, message); };
export function assertExternalSurface(agentId: string | null, executorKind: string | null) {
  if (!agentId || !(APPROVED_EXTERNAL_ROLES as readonly string[]).includes(agentId) || EXTERNAL_SURFACES[agentId] !== executorKind) {
    fail("handoff-unsupported-assistant", "This destination has no supported canonical assistant and external surface mapping. Use the controlled reassignment path.");
  }
}
export async function databaseWallTime(db: CapsuleDb): Promise<Date> {
  if (!db.$queryRaw) return fail("handoff-transaction-required", "A bounded handoff requires the governed command transaction.");
  const rows = await db.$queryRaw`SELECT clock_timestamp() AS "now"` as { now: Date }[];
  const now = rows[0]?.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return fail("handoff-clock-unavailable", "The current database lease time could not be verified.");
  return now;
}
/** The receipt already owns command, environment and room locks. Lock existing identity/policy rows next. */
export async function lockHandoffAuthorityRows(db: CapsuleDb, room: HandoffRoom, userId: string, sourceAgentId: string, targetAgentId: string) {
  if (!db.$queryRaw) return fail("handoff-transaction-required", "A bounded handoff requires the governed command transaction.");
  await db.$queryRaw`SELECT "id" FROM "Agent" WHERE "agentId" IN (${sourceAgentId}, ${targetAgentId}) ORDER BY "id" FOR SHARE`;
  await db.$queryRaw`SELECT "id" FROM "BacklogItem" WHERE "id" = ${room.backlogItemId ?? null} OR "itemId" = ${room.backlogItemId ?? null} ORDER BY "id" FOR SHARE`;
  await db.$queryRaw`SELECT p."id" FROM "Principal" p JOIN "PrincipalAlias" a ON a."principalId" = p."id" WHERE a."issuer" = '' AND ((a."aliasType" = 'user' AND a."aliasValue" = ${userId}) OR (a."aliasType" = 'agent' AND a."aliasValue" IN (${sourceAgentId}, ${targetAgentId}))) ORDER BY p."id" FOR SHARE OF p`;
  await db.$queryRaw`SELECT "id" FROM "PrincipalAlias" WHERE "issuer" = '' AND (("aliasType" = 'user' AND "aliasValue" = ${userId}) OR ("aliasType" = 'agent' AND "aliasValue" IN (${sourceAgentId}, ${targetAgentId}))) ORDER BY "id" FOR SHARE`;
  await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR SHARE`;
  await db.$queryRaw`SELECT "id" FROM "WorkItem" WHERE "id" = ${room.workItemId ?? null} FOR SHARE`;
  await db.$queryRaw`SELECT "id" FROM "WorkCapsuleParticipant" WHERE "workroomId" = ${room.id} ORDER BY "id" FOR SHARE`;
}
const PROTECTED_ROOM_FIELDS = ["objective", "source", "backlogItemId", "epicId", "workItemId", "featureBuildId", "taskRunId", "gitPromotionCandidateId", "changePromotionId", "decisionScope", "portfolioRole", "servedPersona", "activityKind", "outcomeAnchor", "servesPortfolioRoles", "dependsOnPortfolioRoles", "repositoryFullName", "baseBranch", "baseSha", "headBranch", "headSha", "worktreePath", "scopeClaims", "providerRequirements", "promotionPolicy", "contributionMode", "branchTaxonomy", "createdByPrincipalId", "requestedByPrincipalId", "archivedAt"];
/** Shared positive predicate for consequence preview and the locked writer; it grants no access. */
export async function readHandoffAuthority(input: {
  db: CapsuleDb; room: HandoffRoom; actor: WorkCapsuleActor; sourceAgentId: string; targetAgentId: string;
  sourceKind: string; targetKind: string; ownerUserId: string; lock: boolean;
}) {
  const { db, room, actor } = input;
  if (!actor.agentPrincipalId || !actor.principalId || !actor.agentId || actor.userId !== input.ownerUserId) {
    return fail("handoff-authenticated-assistant-required", "The handoff must be made by an authenticated assistant acting for the same human owner.");
  }
  assertExternalSurface(input.sourceAgentId, input.sourceKind);
  assertExternalSurface(input.targetAgentId, input.targetKind);
  if (room.featureBuildId || room.taskRunId || room.archivedAt) return fail("handoff-build-boundary", "A linked build, native task or archived room requires its existing controlled handover.");
  if (input.lock) await lockHandoffAuthorityRows(db, room, input.ownerUserId, input.sourceAgentId, input.targetAgentId);
  const source = await resolveAgentWorkroomAccess({ userId: input.ownerUserId, agentId: input.sourceAgentId, workroomId: room.id, requested: "action" }, db as unknown as Prisma.TransactionClient);
  const target = await resolveAgentWorkroomAccess({ userId: input.ownerUserId, agentId: input.targetAgentId, workroomId: room.id, requested: "action" }, db as unknown as Prisma.TransactionClient);
  const from = source.authorityContext;
  const to = target.authorityContext;
  if (source.decision.level !== "action" || target.decision.level !== "action" || !from?.agentPrincipal || !to?.agentPrincipal || !from.humanPrincipal || !to.humanPrincipal) return fail("handoff-room-admission-required", "Both assistants must already have current action admission to this exact room.");
  if (from.humanPrincipal.id !== actor.principalId || to.humanPrincipal.id !== actor.principalId
      || (actor.agentId === input.sourceAgentId ? from.agentPrincipal.id : to.agentPrincipal.id) !== actor.agentPrincipalId) return fail("handoff-identity-changed", "The authenticated human or assistant identity no longer matches the handoff.");
  const roster = from.room.participants;
  if (roster.length > 1000 || ![from.agentPrincipal.id, to.agentPrincipal.id].every((id) => roster.some((row) => row.principalId === id && row.lifecycle === "active"))) return fail("handoff-room-admission-required", "Both assistants must already be admitted; this handoff cannot create an invitation.");
  if (!ownsRoom({ ...from.humanPrincipal, sensitivityClearance: [] }, roster, [from.room.createdByPrincipalId, from.room.requestedByPrincipalId, from.room.leaseHolderPrincipalId])) return fail("handoff-owner-required", "Only the current human owner may request this handoff through their assistant.");
  if ([from.sensitivityCeiling, to.sensitivityCeiling, readWorkspaceRoomPolicy(from.room.workItem?.evidence).sensitivityCeiling].includes("restricted")) return fail("handoff-restricted-boundary", "Restricted work retains its existing consequential handover.");
  const boundary = {
    room: Object.fromEntries(PROTECTED_ROOM_FIELDS.map((key) => [key, room[key] ?? null])),
    owner: from.humanPrincipal, sourceAssistant: from.agentPrincipal, targetAssistant: to.agentPrincipal,
    roster: roster.map((row) => ({ principalId: row.principalId, lifecycle: row.lifecycle, roles: [...row.roles].sort() })).sort((a, b) => a.principalId.localeCompare(b.principalId)),
    sensitivityCeiling: from.sensitivityCeiling, casePolicy: readWorkspaceRoomPolicy(from.room.workItem?.evidence),
  };
  return { boundary, sourcePrincipalId: from.agentPrincipal.id, targetPrincipalId: to.agentPrincipal.id };
}
export function snapshotHandoff(room: HandoffRoom, boundary: Record<string, unknown>, now: Date): HandoffSnapshot {
  if (!room.leaseHolderPrincipalId || !room.leaseExpiresAt || room.leaseExpiresAt.getTime() <= now.getTime() || !room.executorKind || !room.executorRef) return fail("handoff-lease-expired", "The room needs a live source lease before requesting or acknowledging a handoff.");
  const snapshot = { leaseHolderPrincipalId: room.leaseHolderPrincipalId, leaseExpiresAt: room.leaseExpiresAt.toISOString(), executorKind: room.executorKind, executorRef: room.executorRef, boundary };
  return { ...snapshot, digest: handoffDigest(snapshot) };
}
export function assertRequestedSource(room: HandoffRoom, command: BoundedHandoffRequest, ownerPrincipalId: string | null) {
  if (room.leaseHolderPrincipalId !== ownerPrincipalId || command.expectedLeaseHolderPrincipalId !== room.leaseHolderPrincipalId || command.expectedExecutorKind !== room.executorKind || command.expectedExecutorRef !== room.executorRef) return fail("handoff-source-changed", "The source executor or owner lease changed. Read the room and request a fresh handoff.");
}
export function assertHandoffSnapshot(current: HandoffSnapshot, stored: HandoffSnapshot) {
  if (current.leaseHolderPrincipalId !== stored.leaseHolderPrincipalId || current.leaseExpiresAt !== stored.leaseExpiresAt) return fail("handoff-lease-snapshot-changed", "The room lease was renewed or changed. Read current state and submit a fresh request for receiver acknowledgement.");
  if (current.digest !== stored.digest) return fail("handoff-boundary-changed", "The room's owner, admission, mandate, executor or protected boundary changed. Read current state and request a fresh handoff.");
}
