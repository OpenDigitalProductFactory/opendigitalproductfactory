import { prisma, type Prisma } from "@dpf/db";
import { TASK_IN_FLIGHT_STATES } from "@/lib/tak/task-states";
import { projectRemoteTaskReplay } from "./mcp-task-replay-projection";
import type { RemoteTaskSubmitOutcome } from "./mcp-task-submit-types";
import { reservationIdentity, dispatchIdentity, taskExecutionEligible, type TaskExecutionFence } from "./shared/task-execution-fence";
import { isRecord } from "./shared/coerce";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
export { reservationIdentity, dispatchIdentity } from "./shared/task-execution-fence";

function remoteTaskContent(text: string) { return [{ type: "text", text }]; }

// Inference may finish after cancellation. Every settlement shares the same
// conditional write so no success, wait or exception path can revive a terminal run.
export async function settleRemoteTask(
  args: Prisma.TaskRunUpdateManyArgs & { where: { taskRunId: string } },
  reservation: string | null,
  dispatchClaim: string | null,
  boundReview?: { executionFence: TaskExecutionFence | null; userId: string; agentId: string },
): Promise<RemoteTaskSubmitOutcome | null> {
  const current = await prisma.taskRun.findUnique({
    where: { taskRunId: args.where.taskRunId },
    select: { status: true, updatedAt: true, progressPayload: true, a2aMetadata: true,
      ...(boundReview ? { userId: true, currentAgentId: true } : {}) },
  });
  if (current && (TASK_IN_FLIGHT_STATES as readonly string[]).includes(current.status)
    && reservationIdentity(current.progressPayload) === reservation
    && dispatchIdentity(current.progressPayload) === dispatchClaim
    && (!boundReview || (current.userId === boundReview.userId && current.currentAgentId
      && resolveCanonicalAgentId(current.currentAgentId) === resolveCanonicalAgentId(boundReview.agentId)
      && taskExecutionEligible({ status: current.status, progressPayload: current.progressPayload,
        requestDigest: isRecord(current.a2aMetadata) ? current.a2aMetadata.requestDigest : null,
        executionFence: boundReview.executionFence })))) {
    const written = await prisma.taskRun.updateMany({
      ...args,
      data: {
        ...args.data,
        ...((reservation || dispatchClaim || (current.progressPayload as Prisma.JsonObject | null)?.engagementPreAdmissionContinuation) && args.data.progressPayload && typeof args.data.progressPayload === "object"
          && !Array.isArray(args.data.progressPayload)
          ? { progressPayload: {
              ...args.data.progressPayload,
              // This audit is server-owned history, never the executor's replacement.
              ...((current.progressPayload as Prisma.JsonObject | null)?.engagementPreAdmissionContinuation
                ? { engagementPreAdmissionContinuation: (current.progressPayload as Prisma.JsonObject).engagementPreAdmissionContinuation as Prisma.InputJsonValue }
                : {}),
              ...(reservation ? { resumeReservedAt: reservation } : {}),
              ...(dispatchClaim ? { dispatch: (current.progressPayload as Prisma.JsonObject).dispatch as Prisma.InputJsonValue } : {}),
            } }
          : {}),
      },
      where: { ...args.where, status: current.status, updatedAt: current.updatedAt },
    });
    if (written.count === 1) {
      if (current.a2aMetadata && typeof current.a2aMetadata === "object" && !Array.isArray(current.a2aMetadata)
        && current.a2aMetadata.engagementBinding) {
        const { reconcileEngagementTaskResult } = await import("./coworker-service-catalog/engagement-fulfillment");
        // Task settlement is canonical; a projection interruption is repaired on the next engagement read.
        await reconcileEngagementTaskResult(args.where.taskRunId).catch(() => console.error("Engagement projection deferred; read the original engagement to reconcile persisted task state."));
      }
      return null;
    }
  }
  const persisted = await prisma.taskRun.findUnique({
    where: { taskRunId: args.where.taskRunId },
    select: { status: true, progressPayload: true },
  });
  if (persisted && (TASK_IN_FLIGHT_STATES as readonly string[]).includes(persisted.status)) {
    return projectRemoteTaskReplay({
      existing: { ...persisted, taskRunId: args.where.taskRunId, a2aMetadata: null },
      requestMatches: true,
    });
  }
  return {
    kind: "result",
    result: {
      taskRunId: args.where.taskRunId,
      status: persisted?.status ?? "unknown",
      progressPayload: persisted?.progressPayload ?? null,
      resumable: false,
      requiresApproval: false,
      content: remoteTaskContent("Execution settlement yielded to the persisted task state."),
      isError: !persisted,
    },
  };
}

