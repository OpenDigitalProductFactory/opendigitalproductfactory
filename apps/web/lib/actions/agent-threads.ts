"use server";

import { randomUUID } from "crypto";
import { prisma } from "@dpf/db";
import { THREAD_ERRORS, ThreadSpawnError } from "./agent-thread-errors";
import { dispatchAgentThread } from "./agent-thread-dispatcher";
import { getQuiescenceLevel, QuiescingError } from "@/lib/self-upgrade/quiescence";
import { admitRuntimeGuardedWork } from "@/lib/platform-runtime/work-admission";

type SpawnWorkThreadOptions = {
  title?: string;
  routeContext?: string;
  agentId?: string;
};

function createId(): string {
  return `c${randomUUID().replace(/-/g, "").slice(0, 24).toLowerCase()}`;
}

export async function spawnWorkThread(
  parentId: string,
  objectiveInput: string,
  userId: string,
  opts: SpawnWorkThreadOptions = {},
): Promise<{ child: { id: string }; taskRunId: string }> {
  const objective = objectiveInput.trim();
  if (!objective) throw new Error("OBJECTIVE_REQUIRED");

  // BI-QUIESCE-005 entry-point gate: refuse new TaskRun spawns during
  // quiescence drain. Existing in-flight TaskRuns continue via the
  // cooperative-cancel pathway (heartbeat.ts:27 returns false when the
  // coordinator flips them to 'quiescing'). Caller catches QuiescingError
  // and translates to 503 + Retry-After at the response layer.
  const level = await getQuiescenceLevel();
  if (level !== "normal") {
    throw new QuiescingError(level);
  }

  const spawnResult = await prisma.$transaction(
    async (tx) => {
      const parent = await tx.agentThread.findUniqueOrThrow({
        where: { id: parentId },
        select: {
          id: true,
          userId: true,
          parentThreadId: true,
          childCount: true,
          cancelledAt: true,
        },
      });

      if (parent.userId !== userId) {
        throw new ThreadSpawnError(THREAD_ERRORS.UNAUTHORIZED, "Parent thread is owned by another user.");
      }
      if (parent.parentThreadId) {
        throw new ThreadSpawnError(THREAD_ERRORS.DEPTH_LIMIT_EXCEEDED, "Child threads cannot spawn work threads.");
      }
      if (parent.childCount >= 5) {
        throw new ThreadSpawnError(THREAD_ERRORS.CHILD_LIMIT_EXCEEDED, "Parent thread has reached the child limit.");
      }
      if (parent.cancelledAt) {
        throw new ThreadSpawnError(THREAD_ERRORS.PARENT_CANCELLED, "Cancelled parent threads cannot spawn work.");
      }

      const child = await tx.agentThread.create({
        data: {
          userId,
          contextKey: `work-thread-${randomUUID()}`,
          parentThreadId: parent.id,
        },
        select: { id: true },
      });

      await tx.agentThread.updateMany({
        where: { id: parent.id },
        data: { childCount: { increment: 1 } },
      });

      // EP-A2A: complete the TaskRun lineage graph. spawnWorkThread previously
      // hardcoded parentTaskRunId=null, leaving the child task an orphan in the
      // task graph even though the AgentThread lineage (parentThreadId) was set.
      // Link the child TaskRun to the parent thread's most-recent TaskRun when
      // one exists (build/proactive flows); root coworker threads often have no
      // TaskRun, in which case this stays null and AgentThread.parentThreadId
      // remains the load-bearing lineage edge. References the stable taskRunId.
      const parentTaskRun = await tx.taskRun.findFirst({
        where: { threadId: parent.id },
        orderBy: { startedAt: "desc" },
        select: { taskRunId: true },
      });

      const taskRunId = createId();
      await admitRuntimeGuardedWork(tx as never, "task-run:coworker");
      const tr = await tx.taskRun.create({
        data: {
          taskRunId,
          userId,
          threadId: child.id,
          contextId: child.id,
          initiatingAgentId: opts.agentId ?? null,
          currentAgentId: opts.agentId ?? null,
          parentTaskRunId: parentTaskRun?.taskRunId ?? null,
          routeContext: opts.routeContext ?? null,
          title: opts.title?.trim() || objective.slice(0, 100),
          objective,
          source: "coworker",
          status: "submitted",
          authorityScope: [],
        },
        select: { taskRunId: true },
      });

      await tx.agentMessage.create({
        data: {
          threadId: child.id,
          taskRunId: tr.taskRunId,
          role: "user",
          content: objective,
          agentId: opts.agentId ?? null,
          routeContext: opts.routeContext ?? null,
        },
      });

      return { child, taskRunId: tr.taskRunId };
    },
    { isolationLevel: "Serializable" },
  );

  try {
    await dispatchAgentThread(spawnResult.child.id, userId);
  } catch (error) {
    await prisma.$transaction([
      prisma.agentThread.updateMany({
        where: { id: parentId, childCount: { gt: 0 } },
        data: { childCount: { decrement: 1 } },
      }),
      prisma.taskRun.update({
        where: { taskRunId: spawnResult.taskRunId },
        data: { status: "failed" },
      }),
    ]);
    throw new ThreadSpawnError(
      THREAD_ERRORS.DISPATCH_FAILED,
      error instanceof Error ? error.message : "Failed to dispatch child thread.",
    );
  }

  return spawnResult;
}
