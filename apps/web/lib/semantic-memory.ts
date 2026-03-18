// apps/web/lib/semantic-memory.ts
// Store and recall conversation memories using Qdrant vector database.

import { generateEmbedding } from "./embedding";
import {
  upsertVectors,
  searchSimilar,
  scrollPoints,
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

// ─── Store Capability Knowledge ────────────────────────────────────────────

/**
 * Store a capability (API action / endpoint) as a vector point in platform-knowledge.
 * Unlike storePlatformKnowledge() which stores text documents, this stores structured
 * metadata as payload fields for filter-based lookup via lookupCapabilityByFilter().
 * The embedding is generated from action name + description for semantic search.
 */
export async function storeCapabilityKnowledge(params: {
  specRef: string;
  actionName: string;
  route: string;
  description: string;
  parameterSummary: string;
  requiredCapability: string | null;
  sideEffect: boolean;
  lifecycleStatus: "planned" | "build" | "production";
}): Promise<void> {
  const text = `${params.actionName}: ${params.description}`;
  const embedding = await generateEmbedding(text);
  if (!embedding) return;

  await upsertVectors(QDRANT_COLLECTIONS.PLATFORM_KNOWLEDGE, [
    {
      id: `capability-${params.specRef}-${params.actionName}`,
      vector: embedding,
      payload: {
        entityId: params.actionName,
        entityType: "capability",
        title: params.description,
        contentPreview: params.parameterSummary.slice(0, 300),
        route: params.route,
        action_name: params.actionName,
        lifecycle_status: params.lifecycleStatus,
        side_effect: params.sideEffect,
        spec_ref: params.specRef,
        required_capability: params.requiredCapability ?? "",
        parameter_summary: params.parameterSummary,
        timestamp: new Date().toISOString(),
      },
    },
  ]);
}

// ─── Lookup Capability by Filter ───────────────────────────────────────────

/**
 * Exact-match filter lookup for capabilities stored in platform-knowledge.
 * Uses scrollPoints() (no embedding vector needed) to find capabilities by
 * structured payload fields: specRef, actionName, route, lifecycleStatus.
 * Returns empty array if no filters are provided.
 */
export async function lookupCapabilityByFilter(filter: {
  specRef?: string;
  actionName?: string;
  route?: string;
  lifecycleStatus?: string;
}): Promise<Array<{ actionName: string; specRef: string; lifecycleStatus: string; route: string }>> {
  const conditions: Array<Record<string, unknown>> = [];
  if (filter.specRef) conditions.push({ key: "spec_ref", match: { value: filter.specRef } });
  if (filter.actionName) conditions.push({ key: "action_name", match: { value: filter.actionName } });
  if (filter.route) conditions.push({ key: "route", match: { value: filter.route } });
  if (filter.lifecycleStatus) conditions.push({ key: "lifecycle_status", match: { value: filter.lifecycleStatus } });

  if (conditions.length === 0) return [];

  const points = await scrollPoints(
    QDRANT_COLLECTIONS.PLATFORM_KNOWLEDGE,
    { must: conditions },
    100,
  );

  return points.map((p) => ({
    actionName: String(p.payload["action_name"] ?? ""),
    specRef: String(p.payload["spec_ref"] ?? ""),
    lifecycleStatus: String(p.payload["lifecycle_status"] ?? ""),
    route: String(p.payload["route"] ?? ""),
  }));
}
