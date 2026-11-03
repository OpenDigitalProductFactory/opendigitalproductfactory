import "server-only";
import { prisma } from "@dpf/db";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { requireUser } from "@/lib/actions/shared/guards";
import { isRecord } from "@/lib/shared/coerce";
import { captureTaskExecutionFence, sameTaskExecutionFence, type TaskExecutionFence } from "@/lib/shared/task-execution-fence";
import { withGovernedInferenceDeadline } from "@/lib/routing/governed-inference-deadline";
import { withForegroundExecutionScope, foregroundExecutionContext } from "./foreground-work-execution-scope";
export { foregroundExecutionContext } from "./foreground-work-execution-scope";

/** Queue callers supply only a retained job identity, never a user or role. */
async function currentForegroundActor(taskRunId: string) {
  const run = await prisma.taskRun.findUnique({
    where: { taskRunId },
    select: { userId: true, threadId: true, source: true, status: true, a2aMetadata: true, progressPayload: true, initiatingAgentId: true, archivedAt: true },
  });
  const metadata = isRecord(run?.a2aMetadata) ? run.a2aMetadata : null;
  const request = isRecord(metadata?.foregroundRequest) ? metadata.foregroundRequest : null;
  if (!run?.threadId || run.archivedAt || run.source !== "coworker" || run.status !== "working"
    || metadata?.trigger !== "interactive" || request?.schemaVersion !== 1
    || typeof request.userMessageId !== "string" || typeof request.deadlineAt !== "string") throw new Error("Foreground execution is not admissible.");
  const [human, thread, message] = await Promise.all([
    currentUserContext(run.userId),
    prisma.agentThread.findUnique({ where: { id: run.threadId }, select: { userId: true } }),
    prisma.agentMessage.findFirst({
      where: { id: request.userMessageId, threadId: run.threadId, taskRunId, role: "user" }, select: { id: true },
    }),
  ]);
  if (!human || thread?.userId !== run.userId || !message) throw new Error("Foreground execution authority is no longer valid.");
  return {
    actor: { id: run.userId, platformRole: human.platformRole ?? null, isSuperuser: human.isSuperuser ?? false },
    fence: captureTaskExecutionFence(run.progressPayload, metadata?.requestDigest ?? null),
    agentId: run.initiatingAgentId,
    deadlineAt: request.deadlineAt,
    threadId: run.threadId,
  };
}

/** Revalidation happens at entry and again when the turn resolves its actor. */
export async function withForegroundWork<T>(taskRunId: string, action: () => Promise<T>, expectedFence?: TaskExecutionFence | null): Promise<T> {
  const current = await currentForegroundActor(taskRunId);
  if (expectedFence !== undefined && !sameTaskExecutionFence(expectedFence, current.fence)) throw new Error("Foreground executor was superseded before entry.");
  return withForegroundExecutionScope({ taskRunId, fence: current.fence, agentId: current.agentId, deadlineAt: current.deadlineAt,
    userId: current.actor.id, threadId: current.threadId }, () => withGovernedInferenceDeadline({
    deadlineAt: current.deadlineAt,
    verifyAuthority: async () => {
      const fresh = await currentForegroundActor(taskRunId);
      return sameTaskExecutionFence(current.fence, fresh.fence) && current.agentId === fresh.agentId
        && current.actor.id === fresh.actor.id && current.threadId === fresh.threadId && current.deadlineAt === fresh.deadlineAt;
    },
  }, action));
}

export async function requireForegroundUser() {
  const scope = foregroundExecutionContext();
  if (!scope) return requireUser();
  const current = await currentForegroundActor(scope.taskRunId);
  if (!sameTaskExecutionFence(scope.fence, current.fence)) throw new Error("Foreground executor was superseded.");
  return current.actor;
}

export function foregroundExecutionFence(): TaskExecutionFence | null {
  return foregroundExecutionContext()?.fence ?? null;
}

export function assertForegroundAgent(agentId: string | null | undefined): void {
  const scope = foregroundExecutionContext();
  if (scope && (!scope.agentId || scope.agentId !== agentId)) throw new Error("The assigned foreground coworker changed; reconcile the retained request first.");
}
