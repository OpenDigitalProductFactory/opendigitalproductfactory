import type { McpTaskRunRow } from "@/lib/mcp/tasks-lifecycle";

type Handler = (task: McpTaskRunRow) => boolean | void;

const subscribers = new Map<string, Handler[]>();
const cursors = new Map<string, number>();

/**
 * Process-local delivery accelerator for connected MCP streams. TaskRun is
 * always the durable source of truth; a missed notification is recovered by
 * stream snapshot replay or tasks/get/list.
 */
function subscribe(apiTokenId: string, handler: Handler): () => void {
  const current = subscribers.get(apiTokenId) ?? [];
  current.push(handler);
  subscribers.set(apiTokenId, current);
  return () => {
    const next = (subscribers.get(apiTokenId) ?? []).filter((candidate) => candidate !== handler);
    if (next.length === 0) {
      subscribers.delete(apiTokenId);
      cursors.delete(apiTokenId);
    } else {
      subscribers.set(apiTokenId, next);
    }
  };
}

/**
 * Deliver to one stream for the auth context. Streamable HTTP permits several
 * simultaneous GET streams, but a server must not fan the same message across
 * all of them because that duplicates one logical notification.
 */
function publish(apiTokenId: string, task: McpTaskRunRow): void {
  const handlers = subscribers.get(apiTokenId);
  if (!handlers?.length) return;
  const cursor = cursors.get(apiTokenId) ?? 0;
  for (let offset = 0; offset < handlers.length; offset += 1) {
    const index = (cursor + offset) % handlers.length;
    try {
      // A closed stream returns false. Try one remaining live stream so a
      // stale process-local subscription cannot consume the wake-up.
      if (handlers[index]?.(task) !== false) {
        cursors.set(apiTokenId, index + 1);
        return;
      }
    } catch (error) {
      console.error("[mcp-task-notification-bus] subscriber failed", error);
    }
  }
}

export const mcpTaskNotificationBus = { subscribe, publish };
