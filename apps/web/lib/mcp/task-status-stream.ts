import { prisma } from "@dpf/db";
import { createSseResponse } from "@/lib/sse/sse-stream";
import { mcpTaskNotificationBus } from "@/lib/mcp-task-notification-bus";
import { MCP_TASK_SELECT, toMcpTaskObject } from "./tasks-lifecycle";

export type McpTaskStreamOwner = { tokenId: string; userId: string };

/** Auth-bound Streamable HTTP projection for MCP task-status notifications. */
export async function openMcpTaskStatusStream(
  request: Request,
  owner: McpTaskStreamOwner,
): Promise<Response> {
  const accept = request.headers.get("accept");
  if (accept && !accept.includes("text/event-stream") && !accept.includes("*/*")) {
    return new Response("Not Acceptable — GET requires text/event-stream", {
      status: 406,
      headers: { Accept: "text/event-stream" },
    });
  }

  const snapshots = await prisma.taskRun.findMany({
    where: {
      userId: owner.userId,
      source: "external-mcp",
      a2aMetadata: { path: ["apiTokenId"], equals: owner.tokenId },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: MCP_TASK_SELECT,
  });
  const notification = (task: Parameters<typeof toMcpTaskObject>[0]) => ({
    jsonrpc: "2.0" as const,
    method: "notifications/tasks/status" as const,
    params: toMcpTaskObject(task),
  });

  return createSseResponse({
    signal: request.signal,
    maxAgeMs: 15 * 60_000,
    headers: { "MCP-Protocol-Version": "2025-11-25" },
    start: (stream) => {
      // Durable replay closes commit→subscribe; live delivery is advisory.
      for (const snapshot of snapshots.slice().reverse()) {
        if (!stream.send(notification(snapshot))) return;
      }
      return mcpTaskNotificationBus.subscribe(owner.tokenId, (task) => {
        return stream.send(notification(task));
      });
    },
  });
}
