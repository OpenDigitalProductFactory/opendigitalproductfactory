import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "@dpf/db";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { requireUser } from "@/lib/actions/shared/guards";
import { isRecord } from "@/lib/shared/coerce";
import { captureTaskExecutionFence, sameTaskExecutionFence, type TaskExecutionFence } from "@/lib/shared/task-execution-fence";

const execution = new AsyncLocalStorage<{ taskRunId: string; agentId: string | null; fence: TaskExecutionFence | null }>();

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
    || typeof request.userMessageId !== "string") throw new Error("Foreground execution is not admissible.");
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
  };
}

/** Revalidation happens at entry and again when the turn resolves its actor. */
export async function withForegroundWork<T>(taskRunId: string, action: () => Promise<T>): Promise<T> {
  const current = await currentForegroundActor(taskRunId);
  return execution.run({ taskRunId, fence: current.fence, agentId: current.agentId }, action);
}

export async function requireForegroundUser() {
  const scope = execution.getStore();
  if (!scope) return requireUser();
  const current = await currentForegroundActor(scope.taskRunId);
  if (!sameTaskExecutionFence(scope.fence, current.fence)) throw new Error("Foreground executor was superseded.");
  return current.actor;
}

export function foregroundExecutionFence(): TaskExecutionFence | null {
  return execution.getStore()?.fence ?? null;
}

export function assertForegroundAgent(agentId: string | null | undefined): void {
  const scope = execution.getStore();
  if (scope && (!scope.agentId || scope.agentId !== agentId)) throw new Error("The assigned foreground coworker changed; reconcile the retained request first.");
}
