import { jobs, type AgentChildThreadRunEvent } from "@/lib/jobs";
import { getErrorMessage } from "@/lib/shared/get-error-message";

// BI-287E1DD0: a delegated child thread runs here instead of as an in-process
// promise, so a portal restart cannot orphan it. The agentic loop is
// process-bound (design 2026-10-07-durable-delegation-ledger-design.md §4.6):
// no engine retries; a run that dies with its process, or that the engine gives
// up on, fails the child visibly and tells its parent.
export const agentChildThreadRun = jobs.createFunction(
  {
    id: "agent/child-thread-run",
    retries: 0,
    concurrency: [{ key: "event.data.taskRunId", limit: 1 }],
    triggers: [{ event: "agent/child-thread.run" }],
    onFailure: async ({ event, error }) => {
      const original = (event.data as { event?: { data?: AgentChildThreadRunEvent["data"] } }).event;
      if (!original?.data?.taskRunId) return;
      const { failInterruptedChildThread } = await import("@/lib/tak/child-thread-runtime");
      await failInterruptedChildThread(original.data, getErrorMessage(error));
    },
  },
  async ({ event, step }) => {
    const context = event.data as AgentChildThreadRunEvent["data"];
    await step.run("run-child-thread", async () => {
      const { runChildThreadExecution } = await import("@/lib/tak/child-thread-runtime");
      await runChildThreadExecution(context);
      return null;
    });
    return { taskRunId: context.taskRunId };
  },
);
