import type { Prisma, PrismaClient } from "@dpf/db";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { effectiveBacklogSensitivity } from "@/lib/federation/cross-org-sharing";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/govern/permissions";
import { coworkerAuthorityWhere } from "@/lib/coworker-identity";
import { isToolAllowedByGrants, persistedAgentToolGrants } from "@/lib/agent-grants";
import { OAUTH_EXECUTION_AUTHORITY_SELECT, isCurrentOAuthAccessToken, isCurrentOAuthExecutionAuthority } from "@/lib/auth/oauth-tokens";
import { lockAllNonprodEnvironments } from "@/lib/nonprod/environment-lease-lock";
import { resolveAgentWorkroomAccess, ownsRoom } from "@/lib/work-management/workroom-agent-access.server";
import { readWorkspaceRoomPolicy } from "@/lib/work-management/workspace-room-access";
import { ACCEPTANCE_VERIFICATION_SHAPE_KEY, ACCEPTANCE_VERIFIER_ROLE, ACCEPTANCE_VERIFIER_WRITES } from "@/lib/work-management/acceptance-verification-shape";
import { buildWorkShapeRoleBindingsClaim, readWorkShapeRoleBindings, resolveCurrentWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { assertExternalSurface, databaseWallTime, lockHandoffAuthorityRows, type HandoffRoom } from "./bounded-handoff-authority";
import { assertBoundedHandoffDependencies } from "./bounded-handoff-dependencies";
import { publishRecordedWorkCapsuleActivity } from "./activity-events";
import { revalidatePortalContext } from "@/lib/portal-context/invalidation";
import { BoundedHandoffRefusal } from "./bounded-handoff-command";
import { createWorkCapsule, type CapsuleCreateInput } from "./work-capsule-store";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";
import { resolveAdoptionBacklogBinding } from "./adopt-backlog-binding";
import { establishRoomOwnership } from "./room-ownership";
import { ensureCapsuleWorkItemAnchor } from "./capsule-workitem-anchor";
import { prismaAnchorPorts } from "./capsule-workitem-anchor.server";
import { assertScopeReadback, normalizePersistedScope } from "./scope-input";

const ASSIGNMENT_KIND = "initial-executor-assignment";
const ASSIGNMENT_TOOLS = ["create_workroom", ...ACCEPTANCE_VERIFIER_WRITES];
class InitialAssignmentRefusal extends Error {
  constructor(readonly reason: string) { super(reason); }
}
function refuse(reason: string): never { throw new InitialAssignmentRefusal(reason); }
const uniqueConflict = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
type Input = { db: PrismaClient; params: Record<string, unknown>; actor: WorkCapsuleActor;
  context?: ToolExecutionContext; input: CapsuleCreateInput };

/** Revalidate the actual connection, human capability and persisted grant in the
 * caller's transaction. The locator supplies none of this authority. */
async function currentConnection(tx: Prisma.TransactionClient, { actor, context }: Input) {
  if (!actor.agentId || !actor.principalId || !actor.agentPrincipalId || !actor.taskAuthorityTokenId
    || context?.authSource !== "oauth" || context.apiTokenId !== actor.taskAuthorityTokenId
    || context.taskRunId || context.taskExecutionFence != null) refuse("current-external-assistant-required");
  await tx.$queryRaw`SELECT "id" FROM "McpApiToken" WHERE "id" = ${actor.taskAuthorityTokenId} FOR SHARE`;
  const token = await tx.mcpApiToken.findUnique({ where: { id: actor.taskAuthorityTokenId }, select: OAUTH_EXECUTION_AUTHORITY_SELECT });
  if (!token || token.userId !== actor.userId || token.agentId !== actor.agentId) refuse("connection-binding-changed");
  await tx.$queryRaw`SELECT "id" FROM "OAuthClient" WHERE "id" = ${token.oauthClientId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "AuthorityBinding" WHERE "id" = ${token.authorityBindingId} FOR SHARE`;
  await tx.$queryRaw`SELECT g."id" FROM "AgentToolGrant" g JOIN "Agent" a ON a."id" = g."agentId" WHERE a."agentId" = ${actor.agentId} ORDER BY g."id" FOR SHARE OF g`;
  if (!isCurrentOAuthAccessToken(token) || !await isCurrentOAuthExecutionAuthority(token, tx)) refuse("connection-no-longer-current");
  const human = await currentUserContext(actor.userId, tx);
  const agent = await tx.agent.findFirst({ where: coworkerAuthorityWhere(actor.agentId), include: { toolGrants: true, toolGrantRevocations: true } });
  const held = persistedAgentToolGrants(agent);
  // Each declared write must be reachable; grant alternatives within a tool
  // retain the canonical runtime OR semantics.
  if (!human || !can(human, "manage_backlog") || !ASSIGNMENT_TOOLS.every(tool =>
    isToolAllowedByGrants(tool, held) && isToolAllowedByGrants(tool, context.tokenGrantScopes ?? []))) refuse("current-creation-authority-required");
}

async function currentVerificationTarget(tx: Prisma.TransactionClient, outcomeAnchor: unknown) {
  const target = await resolveAdoptionBacklogBinding(tx, { outcomeAnchor: outcomeAnchor });
  if (!target.bound) refuse("verification-target-unavailable");
  if (target.backlogItemId) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "BacklogItem" WHERE "itemId" = ${target.backlogItemId} FOR SHARE`;
    if (rows.length !== 1) refuse("verification-target-unavailable");
    const policy = await tx.backlogItem.findUnique({ where: { itemId: target.backlogItemId },
      select: { sensitivity: true, scopeKind: true, digitalProduct: { select: { productId: true } } } });
    if (!policy) refuse("verification-target-unavailable");
    const sensitivity = effectiveBacklogSensitivity({ sensitivity: policy.sensitivity, scopeKind: policy.scopeKind,
      digitalProductId: policy.digitalProduct?.productId ?? null });
    if (sensitivity !== "public" && sensitivity !== "internal") refuse("sensitive-verification-target-requires-controlled-assignment");
  }
}

async function currentRoom(tx: Prisma.TransactionClient, capsule: HandoffRoom, args: Input, ref: string) {
  const { actor } = args;
  if (!actor.agentId || !actor.principalId || !actor.agentPrincipalId) refuse("current-external-assistant-required");
  await lockHandoffAuthorityRows(tx as unknown as CapsuleDb, capsule, actor.userId, actor.agentId, actor.agentId);
  const access = await resolveAgentWorkroomAccess({ userId: actor.userId, agentId: actor.agentId, workroomId: capsule.id, requested: "action" }, tx);
  const authority = access.authorityContext;
  if (access.decision.level !== "action" || authority?.humanPrincipal?.id !== actor.principalId
    || authority.agentPrincipal?.id !== actor.agentPrincipalId) refuse("current-room-admission-required");
  if (!authority.room.participants.some(row => row.principalId === actor.agentPrincipalId && row.lifecycle === "active")
    || !ownsRoom(authority.humanPrincipal, authority.room.participants,
      [authority.room.createdByPrincipalId, authority.room.requestedByPrincipalId, authority.room.leaseHolderPrincipalId])) refuse("current-room-owner-required");
  if (authority.sensitivityCeiling === "restricted" || readWorkspaceRoomPolicy(authority.room.workItem?.evidence).sensitivityCeiling === "restricted") refuse("restricted-assignment-boundary");
  if (capsule.backlogItemId != null || capsule.featureBuildId || capsule.taskRunId || capsule.archivedAt || capsule.headSha || capsule.headBranch || capsule.worktreePath
    || capsule.executorRef !== ref || capsule.executorKind !== args.input.executorKind
    || resolveCurrentWorkShapeClaim(capsule.scopeClaims)?.key !== ACCEPTANCE_VERIFICATION_SHAPE_KEY) refuse("source-free-assignment-boundary-changed");
  if (readWorkShapeRoleBindings(capsule.scopeClaims)[ACCEPTANCE_VERIFIER_ROLE] !== `agent:${actor.agentId}`) refuse("current-verifier-role-required");
  const now = await databaseWallTime(tx as unknown as CapsuleDb);
  if (capsule.leaseHolderPrincipalId !== actor.principalId || !(capsule.leaseExpiresAt instanceof Date)
    || capsule.leaseExpiresAt <= now) refuse("current-owned-room-lease-required");
}

/** New external acceptance assignments only. Legacy sessionless rooms and
 * non-null transfers keep their original history and controlled handover. */
export async function createInitiallyAssignedWorkroom(args: Input): Promise<ToolResult> {
  try {
    const raw = args.params.sessionRef;
    if (typeof raw !== "string" || !raw.trim() || raw !== raw.trim() || raw.length > 500) refuse("invalid-executor-reference");
    const ref = raw as string;
    if (Object.hasOwn(args.params, "backlogItemId") || args.input.backlogItemId != null) refuse("verification-target-must-use-outcome-anchor");
    assertExternalSurface(args.actor.agentId, args.input.executorKind ?? null);
    const scope = normalizePersistedScope(args.input.scope);
    if (resolveCurrentWorkShapeClaim([{ workShape: scope.workShape }])?.key !== ACCEPTANCE_VERIFICATION_SHAPE_KEY) refuse("source-free-acceptance-assignment-required");
    if (!args.db.$transaction) refuse("real-assignment-transaction-required");
    const run = async (allowCreate: boolean) => args.db.$transaction(async tx => {
      // Same environment locks as lease allocation; no lease can appear between
      // the dependency proof and this transaction's commit.
      await lockAllNonprodEnvironments(tx);
      const key = `workroom-initial-assignment:${args.input.idempotencyKey}`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      await currentConnection(tx, args);
      const existing = await tx.workroom.findUnique({ where: { idempotencyKey: args.input.idempotencyKey } });
      if (existing) {
        await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "id" = ${existing.id} FOR UPDATE`;
        const room = await tx.workroom.findUniqueOrThrow({ where: { id: existing.id } });
        if (room.executorRef !== ref || room.executorKind !== args.input.executorKind
          || room.createdByPrincipalId !== args.actor.agentPrincipalId || room.requestedByPrincipalId !== args.actor.principalId) refuse("existing-assignment-does-not-match");
        assertScopeReadback(room, args.input.scope);
        await currentVerificationTarget(tx, room.outcomeAnchor);
        const records = await tx.workroomActivity.findMany({ where: { workCapsuleId: room.id, kind: "action", payload: { path: ["kind"], equals: ASSIGNMENT_KIND } }, take: 2 });
        const payload = records.length === 1 ? records[0]?.payload : null;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)
          || payload.executorRef !== ref || payload.agentPrincipalId !== args.actor.agentPrincipalId
          || payload.ownerPrincipalId !== args.actor.principalId) refuse("initial-assignment-evidence-unavailable");
        await currentRoom(tx, room as unknown as HandoffRoom, args, ref);
        await currentConnection(tx, args);
        return { capsule: room, reused: true, activityId: records[0]!.id };
      }
      if (!allowCreate) refuse("concurrent-assignment-winner-unavailable");
      // Verification targets never become the source-authorship subject.
      await currentVerificationTarget(tx, scope.outcomeAnchor);
      const created = await createWorkCapsule({ db: tx as unknown as CapsuleDb,
        actor: args.actor, deferPublication: true, input: { ...args.input, backlogItemId: null, executorRef: ref } });
      await ensureCapsuleWorkItemAnchor({ ports: prismaAnchorPorts(tx), capsuleId: created.capsuleId,
        backlogItemId: created.backlogItemId, title: created.title });
      const ownership = await establishRoomOwnership(tx, { workroomId: created.id,
        ownerPrincipalId: args.actor.principalId, assistantPrincipalId: args.actor.agentPrincipalId ?? null });
      if (ownership.coordinatorPrincipalId !== args.actor.principalId || !ownership.assistantAdmitted) refuse("initial-room-ownership-unavailable");
      await tx.workroom.update({ where: { id: created.id, executorRef: ref, leaseHolderPrincipalId: args.actor.principalId,
        scopeClaims: { equals: created.scopeClaims } }, data: { scopeClaims: [
          ...(Array.isArray(created.scopeClaims) ? created.scopeClaims : []),
          buildWorkShapeRoleBindingsClaim({ [ACCEPTANCE_VERIFIER_ROLE]: `agent:${args.actor.agentId}` }),
        ] as Prisma.InputJsonValue } });
      const room = await tx.workroom.findUniqueOrThrow({ where: { id: created.id } });
      await currentRoom(tx, room as unknown as HandoffRoom, args, ref);
      // There is no fabricated old executor: both dependency locators name the
      // one actual endorsed destination, deduplicated by the existing reader.
      await assertBoundedHandoffDependencies(tx, { capsule: room, sourceExecutorRef: ref, destinationExecutorRef: ref });
      await currentConnection(tx, args);
      await currentRoom(tx, room as unknown as HandoffRoom, args, ref);
      const assignment = await tx.workroomActivity.create({ data: { workCapsuleId: room.id, kind: "action",
        summary: "Authenticated assistant endorsed the initial acceptance executor",
        recordedById: args.actor.userId, recordedByAgentId: args.actor.agentId,
        payload: { kind: ASSIGNMENT_KIND, schemaVersion: 1, executorRef: ref,
          ownerPrincipalId: args.actor.principalId, agentPrincipalId: args.actor.agentPrincipalId!,
          identityAssurance: "Assistant endorsement of a locator; no physical chat authentication or review independence." } } });
      return { capsule: room, reused: false, activityId: assignment.id };
    }, { isolationLevel: "ReadCommitted", timeout: 30_000 });
    let result: Awaited<ReturnType<typeof run>>;
    try { result = await run(true); }
    catch (error) { if (!uniqueConflict(error)) throw error; result = await run(false); }
    if (!result.reused) {
      try { publishRecordedWorkCapsuleActivity(result.capsule.id, result.activityId); revalidatePortalContext(); }
      catch { console.warn("[initial-assignment] Committed assignment notification unavailable."); }
    }
    return { success: true, entityId: result.capsule.capsuleId,
      message: result.reused ? "This workroom already has the matching assignment." : "Created the acceptance workroom and assigned your assistant.",
      data: { capsule: result.capsule, executorAssignment: { state: "endorsed", reused: result.reused,
        identityAssurance: "The authenticated assistant endorses the locator. No physical chat or independent reviewer identity is authenticated." } } };
  } catch (error) {
    return { success: false, error: "initial_executor_assignment_unavailable",
      message: "The coordinator needs to resolve a prerequisite before this acceptance workroom can be assigned.",
      data: { reason: error instanceof InitialAssignmentRefusal ? error.reason : error instanceof BoundedHandoffRefusal ? error.code : "assignment-proof-unavailable" } };
  }
}
