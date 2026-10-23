import { prisma, type Prisma } from "@dpf/db";
import { TASK_IN_FLIGHT_STATES } from "@/lib/tak/task-states";
import { projectRemoteTaskReplay } from "./mcp-task-replay-projection";
import type { RemoteTaskSubmitOutcome } from "./mcp-task-submit-types";
import { reservationIdentity, dispatchIdentity } from "./shared/task-execution-fence";
export { reservationIdentity, dispatchIdentity } from "./shared/task-execution-fence";

function remoteTaskContent(text: string) { return [{ type: "text", text }]; }

// Inference may finish after cancellation. Every settlement shares the same
// conditional write so no success, wait or exception path can revive a terminal run.
export async function settleRemoteTask(
  args: Prisma.TaskRunUpdateManyArgs & { where: { taskRunId: string } },
  reservation: string | null,
  dispatchClaim: string | null,
): Promise<RemoteTaskSubmitOutcome | null> {
  const current = await prisma.taskRun.findUnique({
    where: { taskRunId: args.where.taskRunId },
    select: { status: true, updatedAt: true, progressPayload: true },
  });
  if (current && (TASK_IN_FLIGHT_STATES as readonly string[]).includes(current.status)
    && reservationIdentity(current.progressPayload) === reservation
    && dispatchIdentity(current.progressPayload) === dispatchClaim) {
    const written = await prisma.taskRun.updateMany({
      ...args,
      data: {
        ...args.data,
        ...((reservation || dispatchClaim) && args.data.progressPayload && typeof args.data.progressPayload === "object"
          && !Array.isArray(args.data.progressPayload)
          ? { progressPayload: {
              ...args.data.progressPayload,
              ...(reservation ? { resumeReservedAt: reservation } : {}),
              ...(dispatchClaim ? { dispatch: (current.progressPayload as Prisma.JsonObject).dispatch as Prisma.InputJsonValue } : {}),
            } }
          : {}),
      },
      where: { ...args.where, status: current.status, updatedAt: current.updatedAt },
    });
    if (written.count === 1) return null;
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

