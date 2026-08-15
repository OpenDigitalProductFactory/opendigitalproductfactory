// Knowledge base tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the self-contained "knowledge" domain out of the mcp-tools.ts
// executeTool switch: semantic search over the platform knowledge base and the
// organizational knowledge-article store, drafting a new article, and flagging
// articles that are overdue for review. Each handler lazy-imports the semantic
// memory service (and prisma for the article store) and reproduces the former
// switch case verbatim, so behaviour is identical when the tool is invoked over
// MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "search_knowledge",
    description:
      "Search the platform knowledge base for relevant backlog items, epics, improvement proposals, and specs. Uses semantic similarity, not keyword matching. " +
      "Prefer one well-scoped query over many near-duplicate searches. Pair with list_backlog_items for status filters, not repeated search as a poll.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        type: { type: "string", enum: ["backlog", "epic", "improvement", "spec"], description: "Filter by type (optional)" },
        limit: { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "search_knowledge_base",
    description: "Search organizational knowledge articles (policies, processes, decisions, runbooks, reference material). Returns articles ranked by semantic relevance. Use this when the user asks about how things work, what the policy is, or needs procedural guidance.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        productId: { type: "string", description: "Filter to articles linked to this product (optional)" },
        portfolioId: { type: "string", description: "Filter to articles linked to this portfolio (optional)" },
        category: {
          type: "string",
          enum: ["process", "policy", "decision", "how-to", "reference", "troubleshooting", "runbook"],
          description: "Filter by category (optional)",
        },
        valueStream: {
          type: "string",
          enum: ["evaluate", "explore", "integrate", "deploy", "release", "operate", "consume"],
          description: "Filter by IT4IT value stream (optional)",
        },
        limit: { type: "number", description: "Max results (default 5)" },
      },
      required: ["query"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "create_knowledge_article",
    description:
      "Draft a new knowledge article. The article is created in 'draft' status and must be published separately. " +
      "Use when the user asks to document a process, record a decision, or create a runbook. " +
      "Requires title, body, and category (process|policy|decision|how-to|reference|troubleshooting|runbook). " +
      "On failure: fix the payload once — do not re-call with identical args. " +
      "Search knowledge first to avoid near-duplicate drafts.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Article title" },
        body: { type: "string", description: "Article content in markdown" },
        category: {
          type: "string",
          enum: ["process", "policy", "decision", "how-to", "reference", "troubleshooting", "runbook"],
        },
        productIds: { type: "array", items: { type: "string" }, description: "Product IDs to link (optional)" },
        portfolioIds: { type: "array", items: { type: "string" }, description: "Portfolio IDs to link (optional)" },
        valueStreams: {
          type: "array",
          items: { type: "string", enum: ["evaluate", "explore", "integrate", "deploy", "release", "operate", "consume"] },
          description: "IT4IT value streams (optional)",
        },
        tags: { type: "array", items: { type: "string" }, description: "Free-form tags (optional)" },
      },
      required: ["title", "body", "category"],
    },
    requiredCapability: "manage_backlog",
    executionMode: "proposal",
    sideEffect: true,
  },
  {
    name: "flag_stale_knowledge",
    description: "Check for knowledge articles that haven't been reviewed within their review interval. Returns articles needing attention.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Filter to a specific product (optional)" },
        portfolioId: { type: "string", description: "Filter to a specific portfolio (optional)" },
      },
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
  },
];

async function searchKnowledgeHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { searchPlatformKnowledge } = await import("@/lib/semantic-memory");
  const results = await searchPlatformKnowledge({
    query: String(params["query"] ?? ""),
    entityType: typeof params["type"] === "string" ? params["type"] : undefined,
    limit: typeof params["limit"] === "number" ? params["limit"] : 5,
  });
  if (results.length === 0) {
    return { success: true, message: "No matching knowledge found.", data: { results: [] } };
  }
  const summary = results.map((r) => `${r.entityType}:${r.entityId} — ${r.title} (${Math.round(r.score * 100)}% match)`).join("\n");
  return { success: true, message: summary, data: { results } };
}

async function searchKnowledgeBaseHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { searchKnowledgeArticles } = await import("@/lib/semantic-memory");
  const results = await searchKnowledgeArticles({
    query: String(params["query"] ?? ""),
    productId: typeof params["productId"] === "string" ? params["productId"] : undefined,
    portfolioId: typeof params["portfolioId"] === "string" ? params["portfolioId"] : undefined,
    category: typeof params["category"] === "string" ? params["category"] : undefined,
    valueStream: typeof params["valueStream"] === "string" ? params["valueStream"] : undefined,
    limit: typeof params["limit"] === "number" ? params["limit"] : 5,
  });
  if (results.length === 0) {
    return { success: true, message: "No matching knowledge articles found.", data: { results: [] } };
  }
  const summary = results.map((r) => `${r.category}:${r.articleId} — ${r.title} (${Math.round(r.score * 100)}% match)`).join("\n");
  return { success: true, message: summary, data: { results } };
}

async function createKnowledgeArticleHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const { storeKnowledgeArticle } = await import("@/lib/semantic-memory");

  const title = String(params["title"] ?? "").trim();
  const body = String(params["body"] ?? "").trim();
  const category = String(params["category"] ?? "reference").trim();
  // BI-CAP-D90C6A02: fail closed on missing required fields so agents do not
  // re-submit empty drafts in a loop.
  if (!title || !body || !category) {
    return {
      success: false,
      error: "invalid_input",
      message:
        "create_knowledge_article requires non-empty title, body, and category. " +
        "Do NOT retry with the same empty payload (retryable: false).",
      data: { retryable: false },
    };
  }

  // Generate next articleId: KA-001, KA-002, ...
  const lastArticle = await prisma.knowledgeArticle.findFirst({
    orderBy: { createdAt: "desc" },
    select: { articleId: true },
  });
  const nextNum = lastArticle
    ? parseInt(lastArticle.articleId.replace("KA-", ""), 10) + 1
    : 1;
  const articleId = `KA-${String(nextNum).padStart(3, "0")}`;

  const productIds = Array.isArray(params["productIds"]) ? params["productIds"].map(String) : [];
  const portfolioIds = Array.isArray(params["portfolioIds"]) ? params["portfolioIds"].map(String) : [];
  const valueStreams = Array.isArray(params["valueStreams"]) ? params["valueStreams"].map(String) : [];
  const tags = Array.isArray(params["tags"]) ? params["tags"].map(String) : [];

  try {
    await prisma.knowledgeArticle.create({
      data: {
        articleId,
        title,
        body,
        category,
        status: "draft",
        visibility: "internal",
        authorId: userId,
        valueStreams,
        tags,
        products: productIds.length > 0
          ? { create: productIds.map((id) => ({ digitalProductId: id })) }
          : undefined,
        portfolios: portfolioIds.length > 0
          ? { create: portfolioIds.map((id) => ({ portfolioId: id })) }
          : undefined,
        revisions: {
          create: {
            version: 1,
            title,
            body,
            changeSummary: "Initial draft",
            createdById: userId,
          },
        },
      },
    });

    // Index into Qdrant
    await storeKnowledgeArticle({
      articleId,
      title,
      body,
      category,
      status: "draft",
      productIds,
      portfolioIds,
      valueStreams,
      tags,
    });
  } catch (error) {
    const { getErrorMessage } = await import("@/lib/shared/get-error-message");
    return {
      success: false,
      error: "create_failed",
      message:
        `create_knowledge_article failed: ${getErrorMessage(error)}. ` +
        "Fix title/body/category/links; do NOT re-submit identical args (retryable: false).",
      data: { retryable: false },
    };
  }

  return {
    success: true,
    entityId: articleId,
    message: `Knowledge article ${articleId} created as draft: "${title}". Publish it to make it searchable by AI coworkers.`,
  };
}

async function flagStaleKnowledgeHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");

  const where: Record<string, unknown> = { status: "published" };

  if (typeof params["productId"] === "string") {
    where.products = { some: { digitalProductId: params["productId"] } };
  }
  if (typeof params["portfolioId"] === "string") {
    where.portfolios = { some: { portfolioId: params["portfolioId"] } };
  }

  const articles = await prisma.knowledgeArticle.findMany({
    where: where as never,
    select: {
      articleId: true,
      title: true,
      category: true,
      reviewIntervalDays: true,
      lastReviewedAt: true,
      createdAt: true,
    },
  });

  const now = new Date();
  const stale = articles.filter((a) => {
    const baseline = a.lastReviewedAt ?? a.createdAt;
    const dueDate = new Date(baseline.getTime() + a.reviewIntervalDays * 86400000);
    return now > dueDate;
  });

  if (stale.length === 0) {
    return { success: true, message: "All published knowledge articles are up to date.", data: { articles: [] } };
  }

  const summary = stale.map((a) => {
    const baseline = a.lastReviewedAt ?? a.createdAt;
    const daysOverdue = Math.floor((now.getTime() - baseline.getTime()) / 86400000) - a.reviewIntervalDays;
    return `${a.articleId}: "${a.title}" (${a.category}) — ${daysOverdue} days overdue for review`;
  }).join("\n");

  return { success: true, message: `${stale.length} article(s) need review:\n${summary}`, data: { articles: stale } };
}

const handlers: Record<string, ToolPackHandler> = {
  search_knowledge: (params) => searchKnowledgeHandler(params),
  search_knowledge_base: (params) => searchKnowledgeBaseHandler(params),
  create_knowledge_article: (params, userId) => createKnowledgeArticleHandler(params, userId),
  flag_stale_knowledge: (params) => flagStaleKnowledgeHandler(params),
};

export const knowledgePack: ToolPack = {
  packId: "knowledge",
  definitions,
  handlers,
  grants: {
    search_knowledge: ["registry_read"],
    search_knowledge_base: ["registry_read"],
    create_knowledge_article: ["registry_write"],
    flag_stale_knowledge: ["registry_read"],
  },
};
