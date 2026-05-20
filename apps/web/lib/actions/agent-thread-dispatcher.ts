"use server";

import {
  prepareChildExecution,
  runChildThreadExecution,
} from "./agent-thread-dispatcher-runtime";

export async function dispatchAgentThread(childThreadId: string, userId: string): Promise<void> {
  if (!childThreadId) throw new Error("childThreadId is required");
  if (!userId) throw new Error("userId is required");

  const context = await prepareChildExecution(childThreadId, userId);

  void runChildThreadExecution(context).catch((err) => {
    console.error("[agent-thread-dispatcher] background execution unhandled error", {
      threadId: context.threadId,
      taskRunId: context.taskRunId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
