import { prisma } from "@dpf/db";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import type { UserContext } from "@/lib/permissions";
import { markTaskRunWorking } from "@/lib/observability/heartbeat";
import { executeAutonomousWorkTool } from "@/lib/tak/autonomous-work-run";

import { recoverStaleApprovedRemoteTask } from "./mcp-task-approval-recovery";
import { isStaleApprovalRecoveryRun } from "./mcp-task-approval-recovery-contract";
import type {
  ExistingRemoteTask,
  RemoteTaskSubmitAuth,
  RemoteTaskSubmitOutcome,
  RemoteTaskSubmitParams,
} from "./mcp-task-submit";

/**
 * Resuming an approved writer and recovering an expired one are the same
 * concern, so they live together here. Splitting them out also keeps
 * mcp-task-submit.ts under the module-size ceiling (BI-OPT-RATCHETS).
 *
 * Mirrors remoteTaskContent in mcp-task-submit.ts. Duplicated rather than
 * imported so this module never imports a VALUE from its own caller, which
 * would make the import graph cyclic.
 */
function remoteTaskContent(text: string) {
  return [{ type: "text", text }];
}

type ApprovedRemoteTaskEnvelope = {
  id: string;
  threadId: string;
  manifestActionId: string;
};

const GOVERNED_AUDIT_PARAMETER_KEYS = new Set([
  "_surface",
  "_takAlignment",
  "_takPrecondition",
]);

function originalToolParameters(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !GOVERNED_AUDIT_PARAMETER_KEYS.has(key)),
  );
}

export async function resumeApprovedRemoteTask(input: {
  existing: ExistingRemoteTask;
  token: RemoteTaskSubmitAuth;
  userContext: UserContext;
  parsed: RemoteTaskSubmitParams;
}): Promise<RemoteTaskSubmitOutcome | null> {
  if (input.existing.status !== "input-required") return null;

  const envelope = await prisma.coworkerActionEnvelope.findFirst({
    where: {
      taskRunId: input.existing.taskRunId,
      delegatingUserId: input.token.userId,
      status: "approved",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, threadId: true, manifestActionId: true },
  }) as ApprovedRemoteTaskEnvelope | null;
  if (!envelope) return null;

  const proposedExecution = await prisma.toolExecution.findFirst({
    where: {
      taskRunId: input.existing.taskRunId,
      toolName: envelope.manifestActionId,
      success: false,
      result: { path: ["data", "envelopeId"], equals: envelope.id },
    },
    orderBy: { createdAt: "desc" },
    select: { parameters: true },
  });
  const args = originalToolParameters(proposedExecution?.parameters);
  if (!args) return null;

  const reservation = await prisma.taskRun.updateMany({
    where: {
      taskRunId: input.existing.taskRunId,
      status: "input-required",
      updatedAt: input.existing.updatedAt,
    },
    data: {
      progressPayload: {
        ...(input.existing.progressPayload && typeof input.existing.progressPayload === "object"
          && !Array.isArray(input.existing.progressPayload)
          ? input.existing.progressPayload as Record<string, unknown>
          : {}),
        approvalResumeReserved: true,
      },
    },
  });
  if (reservation.count !== 1) return null;
  await markTaskRunWorking(input.existing.taskRunId);

  const result = await executeAutonomousWorkTool({
    toolName: envelope.manifestActionId,
    args,
    userId: input.token.userId,
    userContext: input.userContext,
    routeContext: input.parsed.routeContext,
    agentId: resolveCanonicalAgentId(input.parsed.agentId),
    threadId: envelope.threadId,
    taskRunId: input.existing.taskRunId,
    apiTokenId: input.token.tokenId,
    tokenScope: input.token.capability,
    externalAccessEnabled: true,
  });
  const currentRun = await prisma.taskRun.findUnique({
    where: { taskRunId: input.existing.taskRunId },
    select: { status: true },
  });
  const status = currentRun?.status === "input-required"
    ? "input-required"
    : result.success ? "completed" : "failed";
  await prisma.taskRun.update({
    where: { taskRunId: input.existing.taskRunId },
    data: {
      status,
      ...(status === "input-required" ? {} : { completedAt: new Date() }),
      progressPayload: {
        ...(input.existing.progressPayload && typeof input.existing.progressPayload === "object"
          && !Array.isArray(input.existing.progressPayload)
          ? input.existing.progressPayload as Record<string, unknown>
          : {}),
        summary: result.message,
        riskClass: input.parsed.riskClass,
        executedToolCount: 1,
        resumedFromApproval: true,
      },
    },
  });

  return {
    kind: "result",
    result: {
      taskRunId: input.existing.taskRunId,
      status,
      idempotentReplay: true,
      resumedFromApproval: true,
      requiresApproval: status === "input-required",
      executedToolCount: 1,
      content: remoteTaskContent(result.message),
      isError: status === "failed",
      ...(result.entityId ? { entityId: result.entityId } : {}),
    },
  };
}

/**
 * A run can only be recovered from a state that still owns its writer.
 * `working` and `stalled` are the runs the canonical reaper left behind;
 * `input-required` is the state an expired approved envelope collapses to, and
 * the ordinary replay cannot reach it because that search matches only
 * unexpired envelopes. `failed` is accepted only by the transaction's narrower
 * exact-Workroom-head prerequisite check.
 */
const RECOVERABLE_STATUSES = new Set(["working", "stalled", "input-required", "failed"]);

/**
 * Recover a stale approved writer envelope on the SAME TaskRun and request
 * digest. Supersedes the expired envelope with one carrying the identical
 * stored binding and writer arguments, then requires fresh exact approval
 * before the writer runs. It never reruns inference and never creates a
 * sibling TaskRun.
 *
 * Returns null when the run is not a recovery candidate, leaving the caller's
 * ordinary replay path untouched.
 */
export async function recoverStaleApprovalOnReplay(input: {
  existing: ExistingRemoteTask;
  requestDigest: string;
  writerToolName: string;
  token: RemoteTaskSubmitAuth;
  userContext: UserContext;
  parsed: RemoteTaskSubmitParams;
}): Promise<RemoteTaskSubmitOutcome | null> {
  const { existing } = input;
  if (!RECOVERABLE_STATUSES.has(existing.status)) return null;
  if (existing.status !== "failed" && !isStaleApprovalRecoveryRun(existing)) return null;

  const recovery = await recoverStaleApprovedRemoteTask({
    taskRunId: existing.taskRunId,
    requestDigest: input.requestDigest,
    expectedUpdatedAt: existing.updatedAt,
    userId: input.token.userId,
    agentId: resolveCanonicalAgentId(input.parsed.agentId),
    writerToolName: input.writerToolName,
  });

  if (recovery?.kind === "fresh-approval-required") {
    return {
      kind: "result",
      result: {
        taskRunId: existing.taskRunId,
        status: "input-required",
        idempotentReplay: true,
        resumedFromApprovalRecovery: true,
        requiresApproval: true,
        replacementEnvelopeId: recovery.replacementEnvelopeId,
        content: remoteTaskContent(
          "The stale approved writer envelope expired. It was superseded on the same TaskRun with the identical stored binding and writer arguments; fresh exact approval is required.",
        ),
        structuredContent: {
          recovery: "expired-approved-envelope",
          taskRunId: existing.taskRunId,
          sourceEnvelopeId: recovery.sourceEnvelopeId,
          replacementEnvelopeId: recovery.replacementEnvelopeId,
          replacementProposalExecutionId: recovery.replacementProposalExecutionId,
          inferenceRerun: false,
        },
        isError: false,
      },
    };
  }

  if (recovery?.kind !== "approved-resume-ready") return null;

  // Re-read after the recovery transaction: the resume path must decide on the
  // post-recovery row, never the pre-recovery snapshot the caller still holds.
  const recovered = await prisma.taskRun.findUnique({
    where: { taskRunId: existing.taskRunId },
    select: {
      id: true,
      taskRunId: true,
      userId: true,
      threadId: true,
      contextId: true,
      status: true,
      progressPayload: true,
      a2aMetadata: true,
      lastHeartbeatAt: true,
      completedAt: true,
      updatedAt: true,
    },
  }) as ExistingRemoteTask | null;
  if (!recovered) return null;

  return resumeApprovedRemoteTask({
    existing: recovered,
    token: input.token,
    userContext: input.userContext,
    parsed: input.parsed,
  });
}
