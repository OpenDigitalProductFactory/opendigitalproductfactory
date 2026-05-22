import { cache } from "react";
import { prisma } from "@dpf/db";
import type {
  AgentMessageProvider,
  AgentMessageRow,
  AttachmentInfo,
} from "@/lib/agent-coworker-types";

type AttachmentRow = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  parsedContent: unknown;
};

type TelemetryRow = {
  agentMessageId: string | null;
  providerId: string;
  modelId: string;
  adapterKind: string;
  executionMode: string;
  startedAt: Date;
};

/** Adapter kinds whose telemetry was the user-visible response (not a shadow/loser). */
const VISIBLE_EXEC_MODES = new Set(["single", "shadow-primary", "race-primary"]);

function serializeMessage(
  m: {
    id: string;
    role: string;
    content: string;
    agentId: string | null;
    routeContext: string | null;
    createdAt: Date;
    providerId?: string | null;
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
  provider?: AgentMessageProvider,
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
  if (provider) {
    row.provider = provider;
  }
  return row;
}

/**
 * Pick the user-visible telemetry row for each agentMessageId.
 *
 * Multiple rows can exist per message in race/shadow modes; only the
 * primary/single rows are what the user actually saw. Most-recent wins for
 * the rare case of replays.
 */
function selectVisibleTelemetry(rows: TelemetryRow[]): Map<string, TelemetryRow> {
  const sorted = [...rows].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const out = new Map<string, TelemetryRow>();
  for (const r of sorted) {
    if (!r.agentMessageId) continue;
    if (!VISIBLE_EXEC_MODES.has(r.executionMode)) continue;
    if (!out.has(r.agentMessageId)) out.set(r.agentMessageId, r);
  }
  return out;
}

/**
 * Build the provider info attached to each assistant turn for display.
 *
 * Returns a map keyed by AgentMessage.id. Telemetry is the source of truth
 * for adapter/model; AgentMessage.providerId is a name-only fallback for
 * pre-telemetry rows.
 */
async function loadProviderInfo(
  messages: Array<{ id: string; role: string; providerId?: string | null }>,
): Promise<Map<string, AgentMessageProvider>> {
  const assistantIds = messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.id);
  if (assistantIds.length === 0) return new Map();

  const telemetry = (await prisma.adapterRunTelemetry.findMany({
    where: { agentMessageId: { in: assistantIds } },
    select: {
      agentMessageId: true,
      providerId: true,
      modelId: true,
      adapterKind: true,
      executionMode: true,
      startedAt: true,
    },
  })) as TelemetryRow[];

  const visible = selectVisibleTelemetry(telemetry);

  // Gather provider ids to resolve display names — from telemetry first, then
  // from AgentMessage.providerId for messages without telemetry.
  const providerIds = new Set<string>();
  for (const r of visible.values()) providerIds.add(r.providerId);
  for (const m of messages) {
    if (m.role === "assistant" && m.providerId && !visible.has(m.id)) {
      providerIds.add(m.providerId);
    }
  }
  if (providerIds.size === 0) return new Map();

  const providers = await prisma.modelProvider.findMany({
    where: { providerId: { in: [...providerIds] } },
    select: { providerId: true, name: true },
  });
  const nameByProviderId = new Map(providers.map((p) => [p.providerId, p.name]));

  const out = new Map<string, AgentMessageProvider>();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    const t = visible.get(m.id);
    if (t) {
      const name = nameByProviderId.get(t.providerId);
      if (!name) continue;
      out.set(m.id, { name, modelId: t.modelId, adapterKind: t.adapterKind });
      continue;
    }
    if (m.providerId) {
      const name = nameByProviderId.get(m.providerId);
      if (!name) continue;
      out.set(m.id, { name, modelId: null, adapterKind: null });
    }
  }
  return out;
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
        providerId: true,
        createdAt: true,
        attachments: {
          select: { id: true, fileName: true, mimeType: true, sizeBytes: true, parsedContent: true },
        },
      },
    });
    const providerInfo = await loadProviderInfo(messages);
    return messages
      .reverse()
      .map((m) => serializeMessage(m, undefined, providerInfo.get(m.id)));
  },
);

export { serializeMessage, loadProviderInfo, selectVisibleTelemetry };
