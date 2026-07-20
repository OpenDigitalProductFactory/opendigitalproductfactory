import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import type { AgentEvent } from "@/lib/agent-event-bus";

type CollaborationReturn = Extract<AgentEvent, { type: "collaboration:return" }>;

/** Project only server-validated return copy; ordinary A2A cards remain metadata-only. */
export function collaborationReturnMessage(
  event: CollaborationReturn,
  routeContext: string,
): AgentMessageRow | null {
  const content = event.ownerMessage?.trim();
  if (!content) return null;
  return {
    id: `provider-advisory-${event.childThreadId}`,
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    agentId: event.toAgentId || null,
    routeContext,
  };
}
