// apps/web/lib/semantic-memory.ts
// Store and recall conversation memories using Qdrant vector database.

import { generateEmbedding } from "./embedding";
import {
  upsertVectors,
  searchSimilar,
  QDRANT_COLLECTIONS,
} from "@dpf/db";

// ─── Store Conversation Memory ──────────────────────────────────────────────

export async function storeConversationMemory(params: {
  messageId: string;
  content: string;
  role: "user" | "assistant";
  userId: string;
  agentId: string;
  routeContext: string;
  threadId: string;
}): Promise<void> {
  const embedding = await generateEmbedding(params.content);
  if (!embedding) return; // silently skip if embedding unavailable

  await upsertVectors(QDRANT_COLLECTIONS.AGENT_MEMORY, [
    {
      id: params.messageId,
      vector: embedding,
      payload: {
        messageId: params.messageId,
        userId: params.userId,
        agentId: params.agentId,
        routeContext: params.routeContext,
        threadId: params.threadId,
        role: params.role,
        contentPreview: params.content.slice(0, 300),
        timestamp: new Date().toISOString(),
      },
    },
  ]);
}

// ─── Recall Relevant Context ────────────────────────────────────────────────

export async function recallRelevantContext(params: {
  query: string;
  userId: string;
  currentThreadId?: string;
  limit?: number;
}): Promise<string | null> {
  const embedding = await generateEmbedding(params.query);
  if (!embedding) return null;

  // Build filter: same user, exclude current thread
  const must: Array<Record<string, unknown>> = [
    { key: "userId", match: { value: params.userId } },
  ];
  if (params.currentThreadId) {
    must.push({
      key: "threadId",
      match: { value: params.currentThreadId },
    });
  }

  // For excluding current thread, use must_not
  const filter: Record<string, unknown> = params.currentThreadId
    ? {
        must: [{ key: "userId", match: { value: params.userId } }],
        must_not: [{ key: "threadId", match: { value: params.currentThreadId } }],
      }
    : { must };

  const results = await searchSimilar(
    QDRANT_COLLECTIONS.AGENT_MEMORY,
    embedding,
    filter,
    params.limit ?? 8,
    0.55, // lower threshold — more recall to compensate for short message window
  );

  if (results.length === 0) return null;

  const contextLines = results.map((r) => {
    const p = r.payload;
    const role = p["role"] === "user" ? "You" : "Agent";
    const route = p["routeContext"] ?? "unknown";
    const preview = String(p["contentPreview"] ?? "");
    return `[${role} on ${route}]: ${preview}`;
  });

  return [
    "",
    "RELEVANT CONTEXT FROM PAST CONVERSATIONS:",
    "These are semantically similar messages from your previous interactions.",
    "Use them to inform your response, but don't reference them explicitly.",
    ...contextLines,
  ].join("\n");
}

// ─── Store Platform Knowledge ───────────────────────────────────────────────

export async function storePlatformKnowledge(params: {
  entityId: string;
  entityType: "backlog" | "epic" | "improvement" | "spec";
  title: string;
  content: string;
}): Promise<void> {
  const text = `${params.title}\n${params.content}`;
  const embedding = await generateEmbedding(text);
  if (!embedding) return;

  await upsertVectors(QDRANT_COLLECTIONS.PLATFORM_KNOWLEDGE, [
    {
      id: `${params.entityType}-${params.entityId}`,
      vector: embedding,
      payload: {
        entityId: params.entityId,
        entityType: params.entityType,
        title: params.title,
        contentPreview: params.content.slice(0, 300),
        timestamp: new Date().toISOString(),
      },
    },
  ]);
}

// ─── Search Platform Knowledge ──────────────────────────────────────────────

export async function searchPlatformKnowledge(params: {
  query: string;
  entityType?: string;
  limit?: number;
}): Promise<Array<{ entityId: string; entityType: string; title: string; score: number }>> {
  const embedding = await generateEmbedding(params.query);
  if (!embedding) return [];

  const filter = params.entityType
    ? { must: [{ key: "entityType", match: { value: params.entityType } }] }
    : undefined;

  const results = await searchSimilar(
    QDRANT_COLLECTIONS.PLATFORM_KNOWLEDGE,
    embedding,
    filter,
    params.limit ?? 5,
    0.6,
  );

  return results.map((r) => ({
    entityId: String(r.payload["entityId"] ?? ""),
    entityType: String(r.payload["entityType"] ?? ""),
    title: String(r.payload["title"] ?? ""),
    score: r.score,
  }));
}
