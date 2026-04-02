import { cache } from "react";
import { prisma } from "@dpf/db";
import type { AgentMessageRow, AttachmentInfo } from "@/lib/agent-coworker-types";

type AttachmentRow = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  parsedContent: unknown;
};

function serializeMessage(
  m: {
    id: string;
    role: string;
    content: string;
    agentId: string | null;
    routeContext: string | null;
    createdAt: Date;
    attachments?: AttachmentRow[];
  },
  proposal?: {
    proposalId: string;
    actionType: string;
    parameters: unknown;
    status: string;
    resultEntityId: string | null;
    resultError: string | null;
  } | null,
): AgentMessageRow {
  const row: AgentMessageRow = {
    id: m.id,
    role: (["user", "assistant", "system"] as const).includes(m.role as AgentMessageRow["role"])
      ? (m.role as AgentMessageRow["role"])
      : "system",
    content: m.content,
    agentId: m.agentId,
    routeContext: m.routeContext,
    createdAt: m.createdAt.toISOString(),
  };
  if (m.attachments && m.attachments.length > 0) {
    row.attachments = m.attachments.map((a): AttachmentInfo => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      parsedSummary: (a.parsedContent as { summary?: string } | null)?.summary ?? null,
    }));
  }
  if (proposal) {
    row.proposal = {
      proposalId: proposal.proposalId,
      actionType: proposal.actionType,
      parameters: proposal.parameters as Record<string, unknown>,
      status: proposal.status,
      ...(proposal.resultEntityId ? { resultEntityId: proposal.resultEntityId } : {}),
      ...(proposal.resultError ? { resultError: proposal.resultError } : {}),
    };
  }
  return row;
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
        attachments: {
          select: { id: true, fileName: true, mimeType: true, sizeBytes: true, parsedContent: true },
        },
      },
    });
    return messages.reverse().map((m) => serializeMessage(m));
  },
);

export { serializeMessage };
