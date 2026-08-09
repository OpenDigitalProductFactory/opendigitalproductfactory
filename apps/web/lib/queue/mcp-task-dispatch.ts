import { inngest } from "./inngest-client";

/** Durable queue boundary for externally submitted MCP work. Only stable
 * TaskRun identity crosses this boundary; credentials and request state do not. */
export async function enqueueRemoteTaskExecution(taskRunId: string): Promise<void> {
  await inngest.send({
    id: `mcp-task:${taskRunId}`,
    name: "mcp/task.execute",
    data: { taskRunId },
  });
}
