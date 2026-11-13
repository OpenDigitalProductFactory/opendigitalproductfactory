import { prisma, type Prisma } from "@dpf/db";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import type { UserContext } from "@/lib/permissions";
import { reserveTaskRunGenerationWorking } from "@/lib/observability/heartbeat";
import { executeAutonomousWorkTool } from "@/lib/tak/autonomous-work-run";

import { recoverStaleApprovedRemoteTask } from "./mcp-task-approval-recovery";
import {
  classifyApprovalCallAgainst,
  type ClassifyApprovalCall,
} from "@/lib/coworker/approval-classification";
import {
  describeExternalApprovalLocation,
  withExternalApprovalLocation,
} from "./mcp/external-approval-location";
import { isStaleApprovalRecoveryRun } from "./mcp-task-approval-recovery-contract";
import type { ExistingRemoteTask, RemoteTaskSubmitAuth, RemoteTaskSubmitOutcome } from "./mcp-task-submit-types";
import type { RemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { GOVERNED_AUDIT_PARAMETER_KEYS, TASK_EXECUTION_FENCE_AUDIT_KEY } from "./attention/coworker-envelope-decision";
import { dispatchIdentity, isBoundReviewTask, parseTaskExecutionFence, reservationIdentity, taskExecutionEligible } from "./shared/task-execution-fence";
import { isRecord } from "./shared/coerce";
import { settleRemoteTask } from "./mcp-task-attempt-state";

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
  return resumeApprovedTask({
    existing: input.existing,
    userId: input.token.userId,
    tokenId: input.token.tokenId,
    tokenScope: input.token.capability,
    userContext: input.userContext,
    routeContext: input.parsed.routeContext,
    agentId: input.parsed.agentId,
    riskClass: input.parsed.riskClass,
    reviewWriterToolName: input.parsed.initiativeReviewBinding?.writerToolName ?? null,
  });
}

/**
 * Who resumes an approved writer, and under which credential. A client replay
 * supplies these from its request; the approval itself supplies them from the
 * stored TaskRun (BI-9FD11E5E). Both take the same reservation below, so only
 * one of them runs the writer.
 */
export type ApprovedTaskResume = {
  existing: ExistingRemoteTask;
  userId: string;
  tokenId: string;
  tokenScope: "read" | "write";
  userContext: UserContext;
  routeContext: string;
  agentId: string;
  riskClass: string;
  /** The review writer, when the task carries an initiative review binding. */
  reviewWriterToolName: string | null;
};

export async function resumeApprovedTask(input: ApprovedTaskResume): Promise<RemoteTaskSubmitOutcome | null> {
  const recoveringCompletedProjection = input.existing.status === "completed";
  if (input.existing.status !== "input-required" && !recoveringCompletedProjection) return null;
  if (recoveringCompletedProjection && !input.reviewWriterToolName) return null;

  const envelope = await prisma.coworkerActionEnvelope.findFirst({
    where: {
      taskRunId: input.existing.taskRunId,
      delegatingUserId: input.userId,
      coworkerAgentId: resolveCanonicalAgentId(input.agentId),
      status: "approved",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, threadId: true, manifestActionId: true },
  }) as ApprovedRemoteTaskEnvelope | null;
  if (!envelope) return null;
  if (
    recoveringCompletedProjection
    && envelope.manifestActionId !== input.reviewWriterToolName
  ) return null;

  const proposedExecution = await prisma.toolExecution.findFirst({
    where: {
      taskRunId: input.existing.taskRunId,
      toolName: envelope.manifestActionId,
      userId: input.userId,
      agentId: resolveCanonicalAgentId(input.agentId),
      success: false,
      result: { path: ["data", "envelopeId"], equals: envelope.id },
    },
    orderBy: { createdAt: "desc" },
    select: { parameters: true },
  });
  const args = originalToolParameters(proposedExecution?.parameters);
  if (!args) return null;
  const executionFence = parseTaskExecutionFence((proposedExecution?.parameters as Record<string, unknown> | null)?.[TASK_EXECUTION_FENCE_AUDIT_KEY]);
  const boundReview = isBoundReviewTask(input.existing.a2aMetadata);
  const metadata = isRecord(input.existing.a2aMetadata) ? input.existing.a2aMetadata : {};
  const binding = isRecord(metadata.initiativeReviewBinding) ? metadata.initiativeReviewBinding : {};
  if (boundReview && (input.existing.userId !== input.userId
    || typeof metadata.requestedAgentId !== "string"
    || resolveCanonicalAgentId(metadata.requestedAgentId) !== resolveCanonicalAgentId(input.agentId)
    || binding.writerToolName !== envelope.manifestActionId || input.reviewWriterToolName !== envelope.manifestActionId
    || !taskExecutionEligible({ status: input.existing.status, progressPayload: input.existing.progressPayload,
      requestDigest: metadata.requestDigest, executionFence, phase: "approval-resume" }))) return null;
  if (boundReview) {
    const { reviewRecoveryToolRefusal } = await import("./mcp-task-review-recovery");
    if (await reviewRecoveryToolRefusal({ taskRunId: input.existing.taskRunId, userId: input.userId,
      apiTokenId: input.tokenId, actingAgentId: input.agentId, executionFence, phase: "approval-resume" })) return null;
  }

  const reservation = await reserveTaskRunGenerationWorking({
    taskRunId: input.existing.taskRunId,
    expectedStatus: input.existing.status,
    updatedAt: input.existing.updatedAt,
    progressPayload: {
      ...(input.existing.progressPayload && typeof input.existing.progressPayload === "object"
        && !Array.isArray(input.existing.progressPayload)
        ? input.existing.progressPayload as Record<string, unknown>
        : {}),
      approvalResumeReserved: true,
    },
  });
  if (!reservation) return null;

  const result = await executeAutonomousWorkTool({
    toolName: envelope.manifestActionId,
    args,
    userId: input.userId,
    userContext: input.userContext,
    routeContext: input.routeContext,
    agentId: resolveCanonicalAgentId(input.agentId),
    threadId: envelope.threadId,
    taskRunId: input.existing.taskRunId,
    apiTokenId: input.tokenId,
    ...(executionFence ? { taskExecutionFence: executionFence } : {}),
    tokenScope: input.tokenScope,
    externalAccessEnabled: true,
  });
  const currentRun = await prisma.taskRun.findUnique({
    where: { taskRunId: input.existing.taskRunId },
    select: { status: true },
  });
  const status = currentRun?.status === "input-required"
    ? "input-required"
    : result.success ? "completed" : "failed";
  const progressPayload: Record<string, Prisma.InputJsonValue | null> = {
    ...(input.existing.progressPayload && typeof input.existing.progressPayload === "object"
      && !Array.isArray(input.existing.progressPayload)
      ? input.existing.progressPayload as Prisma.InputJsonObject
      : {}),
    summary: result.message,
    riskClass: input.riskClass,
    executedToolCount: 1,
    resumedFromApproval: true,
    requiresApproval: status === "input-required",
  };
  if (status === "completed") {
    delete progressPayload.terminalWriterWait;
    delete progressPayload.terminalWriterEscalation;
    delete progressPayload.terminalWriterContextFailure;
  }
  const displaced = await settleRemoteTask({
    where: { taskRunId: input.existing.taskRunId },
    data: {
      status,
      ...(status === "input-required" ? {} : { completedAt: new Date() }),
      progressPayload,
    },
  }, reservationIdentity(input.existing.progressPayload), dispatchIdentity(input.existing.progressPayload),
  boundReview && executionFence ? { executionFence, userId: input.userId, agentId: input.agentId } : undefined);
  if (displaced) return displaced;

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
/**
 * The replacement envelope's lifetime follows the stored writer call's current
 * classification (BI-0012E6CA). The registry is bound here, at a module already
 * inside the web import cycle, so the recovery transaction stays out of it.
 */
const classifyAgainstToolRegistry: ClassifyApprovalCall = async (call) => {
  try {
    const { PLATFORM_TOOLS } = await import("./mcp-tools");
    return classifyApprovalCallAgainst(PLATFORM_TOOLS, call);
  } catch {
    return "unclassified";
  }
};

const RECOVERABLE_STATUSES = new Set(["working", "stalled", "input-required", "failed"]);

/**
 * Recover a stale governed writer envelope on the SAME TaskRun and request
 * digest. This includes a proposal that expired before approval as well as an
 * approved envelope that expired before execution. Supersedes the expired
 * envelope with one carrying the identical stored binding and writer
 * arguments, then requires fresh exact approval before the writer runs. It
 * never reruns inference and never creates a sibling TaskRun.
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
  }, undefined, classifyAgainstToolRegistry);

  if (recovery?.kind === "fresh-approval-required") {
    return {
      kind: "result",
      result: withExternalApprovalLocation({
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
      }, describeExternalApprovalLocation({
        envelopeId: recovery.replacementEnvelopeId,
        delegatingUserId: input.token.userId,
        taskRunId: existing.taskRunId,
      })),
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
