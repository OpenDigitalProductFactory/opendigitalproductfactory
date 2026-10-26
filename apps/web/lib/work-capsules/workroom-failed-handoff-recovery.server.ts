import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";
import { readFailedBoundedHandoffOperation } from "@/lib/coworker/approval-action-evidence";
import { resolveAgentWorkroomAccess, resolveHumanWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { can } from "@/lib/permissions";
import { getAgentToolGrantsAsync, isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";
import { assessBoundedHandoff, readBoundedHandoffLineage } from "./bounded-handoff";
import { BoundedHandoffRefusal } from "./bounded-handoff-command";
import type { FailedHandoffRecovery } from "./workroom-recovery-projection";
import type { CapsuleDb } from "./work-capsule-store-types";
type Input = {
    workroomRowId: string;
    userId: string;
    context?: ToolExecutionContext;
    now?: Date;
};
type Db = Pick<typeof prisma, "workroom" | "workroomActivity" | "coworkerActionEnvelope" | "toolExecution">;
const TOOL = "reassign_workroom_executor";
const PACKET_MAX_BYTES = 3072;
/** A failed operation is history, never consent for another one. */
export async function loadWorkroomFailedHandoffRecovery(input: Input, db: Db = prisma): Promise<FailedHandoffRecovery | null> {
    const now = input.now ?? new Date();
    if (!input.userId || !input.workroomRowId || !Number.isFinite(now.getTime()))
        return null;
    const context = input.context;
    let authorityContext: Awaited<ReturnType<typeof resolveAgentWorkroomAccess>>["authorityContext"];
    try {
        const request = {
            userId: input.userId, workroomId: input.workroomRowId, requested: "content" as const
        };
        const access = context?.agentId ? await resolveAgentWorkroomAccess({ ...request, agentId: context.agentId }, db as never) : await resolveHumanWorkroomAccess(request, db as never);
        if (access.decision.level !== "content" && access.decision.level !== "action")
            return null;
        authorityContext = access.authorityContext;
    }
    catch {
        return null;
    }
    const empty = (reason: string): FailedHandoffRecovery => ({
        kind: "failed-bounded-handoff", state: "unavailable", reason, checkedAt: now.toISOString(), owner: null, original: null, action: null
    });
    try {
        const room = await db.workroom.findUnique({ where: { id: input.workroomRowId }, select: {
                id: true, capsuleId: true, status: true, executorKind: true, executorRef: true, leaseHolderPrincipalId: true, leaseExpiresAt: true, headSha: true, baseSha: true, headBranch: true, worktreePath: true
            } });
        if (!room || ["complete", "archived", "abandoned", "superseded"].includes(room.status))
            return null;
        const envelopes = await db.coworkerActionEnvelope.findMany({
            where: {
                delegatingUserId: input.userId, status: "failed", manifestActionId: TOOL,
                toolExecutions: { some: {
                        toolName: TOOL, success: false, AND: [{ parameters: { path: ["capsuleId"], equals: room.capsuleId } }, { result: { path: ["error"], equals: "handoff-transaction-required" } }]
                    } }
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 2,
            select: {
                id: true, status: true, delegatingUserId: true, coworkerAgentId: true, threadId: true, manifestActionId: true, inputFingerprint: true, argsJson: true, createdAt: true
            }
        });
        if (!envelopes.length)
            return null;
        if (envelopes.length !== 1)
            return empty("handoff-failure-history-ambiguous");
        const operation = await readFailedBoundedHandoffOperation(envelopes[0], db, now);
        if (!operation || operation.command.capsuleId !== room.capsuleId)
            return empty("handoff-original-operation-unproven");
        const base: FailedHandoffRecovery = {
            kind: "failed-bounded-handoff", state: "blocked", reason: "handoff-verification-unavailable", checkedAt: now.toISOString(),
            owner: {
                userId: operation.ownerUserId, agentId: operation.sourceAgentId, executorRef: operation.command.expectedExecutorRef
            },
            original: {
                envelopeId: operation.approvalId, executionId: operation.executionId, executedAt: operation.executedAtIso
            }, action: null
        };
        let lineage: Awaited<ReturnType<typeof readBoundedHandoffLineage>>;
        try {
            lineage = await readBoundedHandoffLineage(db as unknown as CapsuleDb, room as never, operation);
        }
        catch {
            return {
                ...base, state: "unavailable", reason: "handoff-lineage-unavailable"
            };
        }
        if (lineage?.state === "stale") base.staleRequest = { requestId: lineage.requestId, reason: lineage.reason };
        if (lineage?.state === "pending")
            return {
                ...base, state: "waiting", reason: "handoff-receiver-acknowledgement-required", pending: {
                    requestId: lineage.requestId, requestDigest: lineage.requestDigest, receiverRef: lineage.receiverRef
                }
            };
        if (lineage?.state === "completed") {
            if (typeof lineage.toExecutorRef !== "string" || typeof lineage.toExecutorKind !== "string" || lineage.toExecutorRef !== room.executorRef || lineage.toExecutorKind !== room.executorKind || typeof lineage.activityId !== "string" || typeof lineage.recordedAt !== "string" || !Number.isFinite(Date.parse(lineage.recordedAt)) || Date.parse(lineage.recordedAt) < Date.parse(operation.executedAtIso))
                return {
                    ...base, state: "unavailable", reason: "handoff-completion-not-current"
                };
            return {
                ...base, state: "resolved", reason: "handoff-completed-after-original-refusal", resolution: {
                    requestId: lineage.requestId, activityId: lineage.activityId, recordedAt: lineage.recordedAt
                }
            };
        }
        if (room.executorKind !== operation.command.expectedExecutorKind || room.executorRef !== operation.command.expectedExecutorRef)
            return { ...base, reason: "handoff-source-changed" };
        if (context?.authSource !== "oauth" || context.agentId !== operation.sourceAgentId || !context.apiTokenId)
            return { ...base, reason: "authenticated-source-assistant-required" };
        const roomGrants = context.governedRoomAuthority?.()?.authorizedGrants;
        if ((context.tokenScope !== "write" && context.tokenScope !== "admin") || !context.userContext || !can(context.userContext, "manage_backlog")
            || !isToolAllowedByGrants(TOOL, context.tokenGrantScopes ?? []) || !isToolAllowedByGrants(TOOL, await getAgentToolGrantsAsync(context.agentId))
            || (roomGrants != null && !isToolAllowedByGrants(TOOL, [...roomGrants])))
            return { ...base, reason: "handoff-current-write-authority-required" };
        const args = {
            ...operation.command, commandId: "handoff-recovery-" + randomUUID(), handoffManifest: { ...operation.command.handoffManifest, priorFailure: {
                    approvalId: operation.approvalId, executionId: operation.executionId, reason: "handoff-transaction-required", preserve: true
                } }
        };
        if (Buffer.byteLength(JSON.stringify(args), "utf8") > PACKET_MAX_BYTES)
            return { ...base, reason: "handoff-recovery-packet-over-budget" };
        if (!authorityContext?.humanPrincipal?.id || !authorityContext.agentPrincipal?.id)
            return { ...base, reason: "handoff-canonical-identity-unavailable" };
        const actor = {
            userId: input.userId, agentId: context.agentId, principalId: authorityContext.humanPrincipal.id, agentPrincipalId: authorityContext.agentPrincipal.id, taskAuthorityTokenId: context.apiTokenId
        };
        try {
            await assessBoundedHandoff({
                db: db as unknown as CapsuleDb, actor, command: args
            });
        }
        catch (error) {
            return { ...base, reason: error instanceof BoundedHandoffRefusal ? error.code : "handoff-verification-unavailable" };
        }
        return {
            ...base, state: "ready", reason: "current-handoff-prerequisites-satisfied", action: {
                toolName: TOOL, args, requiresExecutionRecheck: true, requiresReceiverAcknowledgement: true
            }
        };
    }
    catch {
        return empty("handoff-history-unavailable");
    }
}
