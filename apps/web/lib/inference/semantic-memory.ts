// apps/web/lib/semantic-memory.ts
// Store and recall conversation memories using Qdrant vector database.

import { generateEmbedding } from "./embedding";
import {
  upsertVectors,
  searchSimilar,
  scrollPoints,
  QDRANT_COLLECTIONS,
} from "@dpf/db";
import {
  semanticMemoryOps,
  semanticMemoryErrors,
  semanticMemoryLatency,
} from "@/lib/metrics";

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Extract top-level route domain from a routeContext path (e.g. "/compliance/regs/x" → "compliance"). */
function extractRouteDomain(routeContext: string): string {
  const seg = routeContext.replace(/^\//, "").split("/")[0];
  return seg || "unknown";
}

// ─── Store Conversation Memory ──────────────────────────────────────────────

export async function storeConversationMemory(params: {
  messageId: string;
  content: string;
  role: "user" | "assistant";
  userId: string;
  agentId: string;
  routeContext: string;
  threadId: string;
  operatingProfileFingerprint?: string | null;
}): Promise<void> {
  const endTimer = semanticMemoryLatency.startTimer({ operation: "store" });
  try {
    const embedding = await generateEmbedding(params.content);
    if (!embedding) {
      semanticMemoryOps.inc({ operation: "store", status: "skipped" });
      console.warn("[semantic-memory] store skipped — embedding unavailable");
      endTimer();
      return;
    }

    await upsertVectors(QDRANT_COLLECTIONS.AGENT_MEMORY, [
      {
        id: params.messageId,
        vector: embedding,
        payload: {
          messageId: params.messageId,
          userId: params.userId,
          agentId: params.agentId,
          routeContext: params.routeContext,
          routeDomain: extractRouteDomain(params.routeContext),
          threadId: params.threadId,
          role: params.role,
          contentPreview: params.content.slice(0, 300),
          operatingProfileFingerprint: params.operatingProfileFingerprint ?? null,
          timestamp: new Date().toISOString(),
        },
      },
    ]);
    semanticMemoryOps.inc({ operation: "store", status: "success" });
    endTimer();
  } catch (err) {
    semanticMemoryErrors.inc({ operation: "store" });
    semanticMemoryOps.inc({ operation: "store", status: "error" });
    endTimer();
    throw err;
  }
}

// ─── Recall Relevant Context ────────────────────────────────────────────────

export async function recallRelevantContext(params: {
  query: string;
  userId: string;
  currentThreadId?: string;
  routeContext?: string;
  limit?: number;
  excludeMessageIds?: Set<string>;
}): Promise<string | null> {
  const governed = await recallGovernedContext({
    ...params,
    actionRisk: "advisory",
  });
  return governed.context;
}

export async function recallGovernedContext(params: {
  query: string;
  userId: string;
  currentThreadId?: string;
  routeContext?: string;
  limit?: number;
  excludeMessageIds?: Set<string>;
  currentOperatingProfileFingerprint?: string | null;
  actionRisk?: "advisory" | "consequential";
}): Promise<{
  context: string | null;
  compressedContext: string | null;
  counts: {
    included: number;
    withheld: number;
    current: number;
    legacy: number;
  };
}> {
  const endTimer = semanticMemoryLatency.startTimer({ operation: "recall" });
  try {
    const embedding = await generateEmbedding(params.query);
    if (!embedding) {
      semanticMemoryOps.inc({ operation: "recall", status: "skipped" });
      console.warn("[semantic-memory] recall skipped — embedding unavailable");
      endTimer();
      return {
        context: null,
        compressedContext: null,
        counts: {
          included: 0,
          withheld: 0,
          current: 0,
          legacy: 0,
        },
      };
    }

    const limit = params.limit ?? 8;
    const threshold = 0.55; // lower threshold — more recall to compensate for short message window

    // Base filter: same user, exclude current thread
    const baseMust: Array<Record<string, unknown>> = [
      { key: "userId", match: { value: params.userId } },
    ];
    const baseMustNot: Array<Record<string, unknown>> = params.currentThreadId
      ? [{ key: "threadId", match: { value: params.currentThreadId } }]
      : [];

    // Two-pass retrieval: scoped first, then global fallback
    let results: Array<{ payload: Record<string, unknown>; score: number; id: string | number }> = [];

    // Pass 1: Route-scoped search (if routeContext provided)
    if (params.routeContext) {
      const domain = extractRouteDomain(params.routeContext);
      const scopedFilter: Record<string, unknown> = {
        must: [...baseMust, { key: "routeDomain", match: { value: domain } }],
        ...(baseMustNot.length > 0 ? { must_not: baseMustNot } : {}),
      };
      results = await searchSimilar(
        QDRANT_COLLECTIONS.AGENT_MEMORY, embedding, scopedFilter, limit, threshold,
      );
    }

    // Pass 2: Global fallback if scoped returned fewer than 3 results
    if (results.length < 3) {
      const globalFilter: Record<string, unknown> = {
        must: baseMust,
        ...(baseMustNot.length > 0 ? { must_not: baseMustNot } : {}),
      };
      const globalResults = await searchSimilar(
        QDRANT_COLLECTIONS.AGENT_MEMORY, embedding, globalFilter, limit, threshold,
      );
      // Merge, deduplicating by id, scoped results take priority
      const seen = new Set(results.map((r) => String(r.id)));
      for (const r of globalResults) {
        if (!seen.has(String(r.id))) {
          results.push(r);
          seen.add(String(r.id));
        }
      }
      // Re-sort by score descending and trim to limit
      results.sort((a, b) => b.score - a.score);
      results = results.slice(0, limit);
    }

    // Deduplicate: remove results whose messageId is already in the chat window
    if (params.excludeMessageIds && params.excludeMessageIds.size > 0) {
      results = results.filter((r) => {
        const mid = String(r.payload["messageId"] ?? "");
        return !params.excludeMessageIds!.has(mid);
      });
    }

    semanticMemoryOps.inc({ operation: "recall", status: "success" });
    endTimer();

    if (results.length === 0) {
      return {
        context: null,
        compressedContext: null,
        counts: {
          included: 0,
          withheld: 0,
          current: 0,
          legacy: 0,
        },
      };
    }

    const currentFingerprint = params.currentOperatingProfileFingerprint ?? null;
    const actionRisk = params.actionRisk ?? "advisory";
    const shouldEnforceFreshness = actionRisk === "consequential" && !!currentFingerprint;
    const currentResults = shouldEnforceFreshness
      ? results.filter(
          (result) => result.payload["operatingProfileFingerprint"] === currentFingerprint,
        )
      : results;
    const withheldCount = shouldEnforceFreshness ? results.length - currentResults.length : 0;
    const legacyCount = results.filter((result) => !result.payload["operatingProfileFingerprint"]).length;
    const activeResults = currentResults;

    const contextLines = activeResults.map((r) => {
      const p = r.payload;
      const role = p["role"] === "user" ? "You" : "Agent";
      const route = p["routeContext"] ?? "unknown";
      const preview = String(p["contentPreview"] ?? "");
      return `[${role} on ${route}]: ${preview}`;
    });

    const context = [
      "",
      "RELEVANT CONTEXT FROM PAST CONVERSATIONS:",
      "These are semantically similar messages from your previous interactions.",
      "Use them to inform your response, but don't reference them explicitly.",
      ...contextLines,
    ].join("\n");
    const compressedContext =
      contextLines.length === 0
        ? null
        : [
            "",
            "RELEVANT CONTEXT FROM PAST CONVERSATIONS:",
            "These are semantically similar messages from your previous interactions.",
            ...contextLines.slice(0, 3),
          ].join("\n");

    return {
      context: contextLines.length === 0 ? null : context,
      compressedContext,
      counts: {
        included: activeResults.length,
        withheld: withheldCount,
        current: activeResults.length,
        legacy: legacyCount,
      },
    };
  } catch (err) {
    semanticMemoryErrors.inc({ operation: "recall" });
    semanticMemoryOps.inc({ operation: "recall", status: "error" });
    endTimer();
    throw err;
  }
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
      // Shared fields (entityId, entityType, title, contentPreview) use camelCase
      // for backward compatibility with searchPlatformKnowledge() results.
      // Capability-specific fields use snake_case to match Qdrant payload indexes
      // created by ensurePayloadIndexes() — Qdrant requires exact field name matches.
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

// ─── Store Knowledge Article ──────────────────────────────────────────────

/**
 * Index a knowledge article into Qdrant platform-knowledge collection.
 * Embeds title+body for semantic search. Stores structured payload fields
 * for filter-based discovery by product, portfolio, category, value stream.
 */
export async function storeKnowledgeArticle(params: {
  articleId: string;
  title: string;
  body: string;
  category: string;
  status: string;
  productIds: string[];
  portfolioIds: string[];
  valueStreams: string[];
  tags: string[];
}): Promise<void> {
  const text = `${params.title}\n${params.body}`;
  const embeddingText = text.length > 8000 ? text.slice(0, 8000) : text;
  const embedding = await generateEmbedding(embeddingText);
  if (!embedding) return;

  await upsertVectors(QDRANT_COLLECTIONS.PLATFORM_KNOWLEDGE, [
    {
      id: `knowledge-article-${params.articleId}`,
      vector: embedding,
      payload: {
        entityId: params.articleId,
        entityType: "knowledge-article",
        title: params.title,
        contentPreview: params.body.slice(0, 500),
        category: params.category,
        status: params.status,
        product_ids: params.productIds,
        portfolio_ids: params.portfolioIds,
        value_streams: params.valueStreams,
        tags: params.tags,
        timestamp: new Date().toISOString(),
      },
    },
  ]);
}

// ─── Search Knowledge Articles ────────────────────────────────────────────

/**
 * Semantic search for knowledge articles with optional payload filters.
 * Only returns published articles by default. Combines embedding similarity
 * with Qdrant payload filters for product, portfolio, category, value stream.
 */
export async function searchKnowledgeArticles(params: {
  query: string;
  productId?: string;
  portfolioId?: string;
  category?: string;
  valueStream?: string;
  limit?: number;
}): Promise<Array<{
  articleId: string;
  title: string;
  category: string;
  contentPreview: string;
  score: number;
}>> {
  const embedding = await generateEmbedding(params.query);
  if (!embedding) return [];

  const must: Array<Record<string, unknown>> = [
    { key: "entityType", match: { value: "knowledge-article" } },
    { key: "status", match: { value: "published" } },
  ];
  if (params.productId) must.push({ key: "product_ids", match: { value: params.productId } });
  if (params.portfolioId) must.push({ key: "portfolio_ids", match: { value: params.portfolioId } });
  if (params.category) must.push({ key: "category", match: { value: params.category } });
  if (params.valueStream) must.push({ key: "value_streams", match: { value: params.valueStream } });

  const results = await searchSimilar(
    QDRANT_COLLECTIONS.PLATFORM_KNOWLEDGE,
    embedding,
    { must },
    params.limit ?? 5,
    0.55,
  );

  return results.map((r) => ({
    articleId: String(r.payload["entityId"] ?? ""),
    title: String(r.payload["title"] ?? ""),
    category: String(r.payload["category"] ?? ""),
    contentPreview: String(r.payload["contentPreview"] ?? ""),
    score: r.score,
  }));
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
  conditions.unshift({ key: "entityType", match: { value: "capability" } });

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
