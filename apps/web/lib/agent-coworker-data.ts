import { cache } from "react";
import { prisma } from "@dpf/db";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";

function serializeMessage(m: {
  id: string;
  role: string;
  content: string;
  agentId: string | null;
  routeContext: string | null;
  createdAt: Date;
}): AgentMessageRow {
  return {
    id: m.id,
    role: (["user", "assistant", "system"] as const).includes(m.role as AgentMessageRow["role"])
      ? (m.role as AgentMessageRow["role"])
      : "system",
    content: m.content,
    agentId: m.agentId,
    routeContext: m.routeContext,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Get recent messages for a thread. React-cache deduped within a single request.
 * MUST only be called after session verification (shell layout).
 */
export const getRecentMessages = cache(
  async (threadId: string, limit = 50): Promise<AgentMessageRow[]> => {
    // Fetch newest N in desc order, then reverse to get chronological for display
    const messages = await prisma.agentMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        role: true,
        content: true,
        agentId: true,
        routeContext: true,
        createdAt: true,
      },
    });
    return messages.reverse().map(serializeMessage);
  },
);

export { serializeMessage };
