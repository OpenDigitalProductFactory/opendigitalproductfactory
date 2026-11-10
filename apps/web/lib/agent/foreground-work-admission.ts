import { createAutonomousWorkRun } from "@/lib/tak/autonomous-work-run";
import { createTaskMessage } from "@/lib/tak/task-records";
import { foregroundRequestDigest } from "./foreground-request-digest";
import { foregroundReceiptId } from "./foreground-work-contract";
import { prisma } from "@dpf/db";
import { createHash } from "node:crypto";
import { isRecord } from "@/lib/shared/coerce";

/** Server-only admission. Never accept a TaskRun identity from the browser. */
export async function admitForegroundWork(input: {
  userId: string;
  agentId: string;
  threadId: string;
  userMessageId: string;
  routeContext: string;
  content: string;
  coworkerMode?: "advise" | "act";
  requestExtras?: Record<string, unknown>;
}): Promise<string> {
  const extras = JSON.parse(JSON.stringify(input.requestExtras ?? {}));
  const taskRunId = `TR-CHAT-${createHash("sha256").update(input.userMessageId).digest("hex").slice(0, 32)}`;
  const deadlineAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const digestAt = (originalDeadline: string) => foregroundRequestDigest({
    userId: input.userId, agentId: input.agentId, threadId: input.threadId,
    userMessageId: input.userMessageId, routeContext: input.routeContext,
    content: input.content.trim(), coworkerMode: input.coworkerMode ?? "advise", extras, deadlineAt: originalDeadline,
  });
  const requestDigest = digestAt(deadlineAt);
  const retained = async () => {
    const run = await prisma.taskRun.findUnique({ where: { taskRunId }, select: { userId: true, threadId: true, source: true, a2aMetadata: true } });
    if (!run) return null;
    const metadata = isRecord(run.a2aMetadata) ? run.a2aMetadata : null;
    const original = isRecord(metadata?.foregroundRequest) ? metadata.foregroundRequest : null;
    if (run.userId !== input.userId || run.threadId !== input.threadId || run.source !== "coworker"
      || typeof original?.deadlineAt !== "string" || metadata?.requestDigest !== digestAt(original.deadlineAt)) throw new Error("The retained foreground request does not match this submission.");
    return taskRunId;
  };
  const existing = await retained();
  if (existing) return existing;
  try {
    const run = await createAutonomousWorkRun({
    taskRunId,
    trigger: "interactive",
    userId: input.userId,
    agentId: input.agentId,
    threadId: input.threadId,
    routeContext: input.routeContext,
    title: "Foreground coworker request",
    objective: input.content,
    prompt: input.content,
    sourceRef: { kind: "agent-message", id: input.userMessageId },
    metadata: {
      requestDigest,
      foregroundRequest: {
        schemaVersion: 1,
        userMessageId: input.userMessageId,
        coworkerMode: input.coworkerMode ?? "advise",
        deadlineAt,
        extras,
      },
    },
    afterTaskCreated: async (tx, task) => {
      const thread = await tx.agentThread.findUnique({
        where: { id: input.threadId }, select: { userId: true },
      });
      if (thread?.userId !== input.userId) throw new Error("Foreground conversation authority changed.");
      // Link only the authenticated caller's exact already-accepted message.
      // Any mismatch rolls back the TaskRun and immutable request together.
      const linked = await tx.agentMessage.updateMany({
        where: {
          id: input.userMessageId,
          threadId: input.threadId,
          role: "user",
          content: input.content.trim(),
          taskRunId: null,
        },
        data: { taskRunId: task.taskRunId },
      });
      if (linked.count !== 1) throw new Error("Foreground request is already linked or no longer matches.");
      await createTaskMessage({
        taskRunId: task.taskRunId,
        taskRunRecordId: task.id,
        contextId: task.contextId,
        role: "user",
        content: input.content.trim(),
        metadata: { kind: "foreground-request", userMessageId: input.userMessageId },
      }, tx);
      await tx.agentMessage.create({ data: {
        id: foregroundReceiptId(task.taskRunId), threadId: input.threadId,
        role: "system", agentId: input.agentId, routeContext: input.routeContext,
        taskRunId: task.taskRunId,
        content: `Your request is saved. Its progress and result will stay in this conversation.\n\nRequest reference: ${task.taskRunId}`,
      } });
    },
  });
  return run.taskRunId;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error.code === "P2002" || error.code === "P2034")) {
      const existing = await retained();
      if (existing) return existing;
    }
    throw error;
  }
}
