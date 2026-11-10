"use server";

import {
  prepareChildExecution,
  runChildThreadExecution,
} from "@/lib/tak/child-thread-runtime";
import { getErrorMessage } from "@/lib/shared/get-error-message";

/** BI-287E1DD0 kill switch: `off` restores the in-process dispatch. */
function durableChildDispatchEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const configured = env.DPF_CHILD_THREAD_DURABLE_DISPATCH?.trim().toLowerCase();
  return configured !== "off" && configured !== "false" && configured !== "0";
}

export async function dispatchAgentThread(childThreadId: string, userId: string): Promise<void> {
  if (!childThreadId) throw new Error("childThreadId is required");
  if (!userId) throw new Error("userId is required");

  const context = await prepareChildExecution(childThreadId, userId);

  if (durableChildDispatchEnabled()) {
    // A job owns the child, so a portal restart cannot orphan it. The id is the
    // TaskRun's, so a repeated dispatch starts nothing new.
    const { jobs } = await import("@/lib/jobs");
    await jobs.send({
      id: `agent-child-thread-run:${context.taskRunId}`,
      name: "agent/child-thread.run",
      data: context,
    });
    return;
  }

  void runChildThreadExecution(context).catch((err) => {
    console.error("[agent-thread-dispatcher] background execution unhandled error", {
      threadId: context.threadId,
      taskRunId: context.taskRunId,
      error: getErrorMessage(err),
    });
  });
}
