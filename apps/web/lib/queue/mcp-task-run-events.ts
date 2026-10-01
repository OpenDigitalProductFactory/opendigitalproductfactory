import { jobs } from "@/lib/jobs";

export const REMOTE_TASK_EXECUTION_EVENT = "mcp/task-run.execute" as const;

/** Queue-owned adapter for the external MCP TaskRun execution event. */
export async function sendMcpTaskRunExecutionEvent(
  taskRunId: string,
  eventId: string,
): Promise<void> {
  await jobs.send({
    id: eventId,
    name: REMOTE_TASK_EXECUTION_EVENT,
    data: { taskRunId },
  });
}
