// MCP task-result read tool (BI-B1A6A2BE).
//
// The MCP `tasks/result` method is the documented way for an original owner to
// read an existing task result, including the bounded `originalResult`
// projection for initiative reviews. Agent clients that can only send
// tools/call (observed: Codex, Claude Code) cannot reach a protocol method, so
// this tool exposes the same read as an ordinary tool. It delegates to the one
// handler `tasks/result` uses; every authority check and redaction stays there.
//
// The acting coworker and grant scopes come only from the governed execution
// context, never from tool arguments. Missing context fails closed: the
// original-result reader then refuses with its own unknown classification.
// Read-only: no dispatch, replay, settlement or status healing.
//
// Grants mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { RegisteredToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import type { ToolPack } from "../tool-pack";

const REQUEST_DIGEST = /^[a-f0-9]{64}$/;

const definitions: RegisteredToolDefinition[] = [
  {
    name: "read_task_result",
    description:
      "Read an existing task's result: the same read as the MCP tasks/result method, for clients that can only call tools. " +
      "For an original initiative review it returns the bounded originalResult projection under your current read scopes, " +
      "original human/coworker identity and exact Workroom content access. Read-only: never retries, replays, dispatches or settles.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", minLength: 1, maxLength: 512, description: "Exact task id (TaskRun id, e.g. TR-GATE-…)." },
        requestDigest: { type: "string", pattern: "^[a-f0-9]{64}$", description: "Optional saved request digest that pins readback to the original request." },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
    workroomAccess: "outside-workroom",
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
];

async function readTaskResult(
  params: Record<string, unknown>,
  userId: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const taskId = typeof params.taskId === "string" ? params.taskId.trim() : "";
  const requestDigest = params.requestDigest;
  if (!taskId || taskId.length > 512) {
    return { success: false, error: "invalid_input", message: "taskId must be a nonempty task id of at most 512 characters." };
  }
  if (requestDigest !== undefined && (typeof requestDigest !== "string" || !REQUEST_DIGEST.test(requestDigest))) {
    return { success: false, error: "invalid_input", message: "requestDigest must be 64 lowercase hex characters." };
  }
  const { handleTasksResult, tasksLifecycleEnabled } = await import("@/lib/mcp/tasks-lifecycle");
  if (!tasksLifecycleEnabled()) {
    return { success: false, error: "tasks_lifecycle_disabled", message: "Task readback is disabled on this installation." };
  }
  // Only the validated identifiers cross; caller-supplied identity fields are dropped.
  const lifecycleParams: Record<string, unknown> = { taskId, ...(requestDigest !== undefined ? { requestDigest } : {}) };
  const outcome = await handleTasksResult(userId, lifecycleParams, {
    actingAgentId: context?.agentId ?? null,
    tokenGrantScopes: context?.tokenGrantScopes ?? [],
  });
  if (outcome.kind !== "ok") {
    return { success: false, error: outcome.kind, message: outcome.message };
  }
  return {
    success: true,
    message: `Task ${taskId} result read. This readback grants no retry, replay or settlement.`,
    data: { taskId, result: outcome.value as Record<string, unknown> },
  };
}

export const mcpTaskResultPack: ToolPack = {
  packId: "mcp-task-result",
  definitions,
  handlers: { read_task_result: readTaskResult },
  grants: { read_task_result: ["backlog_read"] },
};
