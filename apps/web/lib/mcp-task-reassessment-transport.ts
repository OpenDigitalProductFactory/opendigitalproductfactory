import type { ResolvedMcpTransportAuth } from "./mcp/transport-auth";
import type { ToolResult } from "./mcp-tool-types";
import { reviewRecoveryToolRefusal } from "./mcp-task-review-recovery";

/** Transport meta-tools and Tasks methods do not enter governedExecuteTool.
 * Apply the same captured callback authority before those handlers can run.
 * Existing owner readback keeps its own content/grant checks in the Tasks lane. */
export async function reviewTaskTransportRefusal(input: {
  token: ResolvedMcpTransportAuth;
  method: string;
  params?: Record<string, unknown>;
}): Promise<ToolResult | null> {
  const { token, method, params } = input;
  if (!token.taskRunId) return null;
  if (["initialize", "notifications/initialized", "ping"].includes(method)) return null;
  if ((method === "tasks/get" || method === "tasks/result")
    && params?.taskId === token.taskRunId) return null;
  return reviewRecoveryToolRefusal({ taskRunId: token.taskRunId,
    userId: token.userId, apiTokenId: token.tokenId,
    ...(token.agentId ? { actingAgentId: token.agentId } : {}),
    executionFence: token.taskExecutionFence });
}
