// Cancelling a thread stops it and its delegated children (BI-259F6743, design
// docs/superpowers/specs/2026-10-07-durable-delegation-ledger-design.md §4.5).
//
// A loop stops two ways: the in-process cancel flag it checks at each
// iteration (agentEventBus.isCancelled), and its TaskRun leaving `working`,
// which its cooperative heartbeat sees from any process. Cancelling marks the
// thread and every open child, cancels their unfinished TaskRuns in one
// transaction, then raises the in-process flags.

import { prisma } from "@dpf/db";
import { agentEventBus } from "@/lib/agent-event-bus";
import { TERMINAL_TASK_STATE_LIST } from "@/lib/tak/task-states";

export type CancelThreadResult = { ok: true; cancelledThreadIds: string[] };

export async function cancelThreadTree(threadId: string, userId: string): Promise<CancelThreadResult> {
  const thread = await prisma.agentThread.findUnique({
    where: { id: threadId },
    select: { id: true, userId: true, cancelledAt: true },
  });
  if (!thread) throw new Error(`Thread ${threadId} not found.`);
  if (thread.userId !== userId) throw new Error("Unauthorized: thread is owned by another user.");

  const now = new Date();
  const cancelledThreadIds = await prisma.$transaction(async (tx) => {
    const children = await tx.agentThread.findMany({
      where: { parentThreadId: thread.id, cancelledAt: null },
      select: { id: true },
    });
    const ids = [...(thread.cancelledAt ? [] : [thread.id]), ...children.map((child) => child.id)];
    if (ids.length === 0) return [];
    await tx.agentThread.updateMany({ where: { id: { in: ids }, cancelledAt: null }, data: { cancelledAt: now } });
    await tx.taskRun.updateMany({
      where: { threadId: { in: ids }, status: { notIn: [...TERMINAL_TASK_STATE_LIST] } },
      data: { status: "canceled", completedAt: now },
    });
    return ids;
  });
  for (const id of cancelledThreadIds) agentEventBus.requestCancel(id);
  return { ok: true, cancelledThreadIds };
}
