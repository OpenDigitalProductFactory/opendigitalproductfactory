// Version-history & source-browsing tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the self-contained "version history" domain out of the mcp-tools.ts
// executeTool switch: listing shipped product versions from the DB, and the
// production-safe git-history browsers that read a file, grep, list a directory,
// or diff between two versions without the source tree on disk. Each handler
// lazy-imports its single backing service (the git-utils helper module, or
// prisma for the product-version store) and reproduces the former switch case
// verbatim, so behaviour is identical when the tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "query_version_history",
    description: "List product versions with their git tags, ship dates, change counts, and promotion status. Optionally filter by digital product ID.",
    inputSchema: {
      type: "object",
      properties: {
        digitalProductId: { type: "string", description: "Filter by product (optional — returns all if omitted)" },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "read_source_at_version",
    description: "Read a file from the codebase at a specific version tag. Uses git history — works in production without source code. Default version: DEPLOYED_VERSION or HEAD.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        version: { type: "string", description: "Git tag or ref (default: deployed version)" },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "search_source_at_version",
    description: "Search the codebase at a specific version for a text pattern. Uses git grep — works in production without source code.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regex pattern to search" },
        version: { type: "string", description: "Git tag or ref (default: deployed version)" },
        glob: { type: "string", description: "File glob filter (e.g., '*.ts')" },
        maxResults: { type: "number", description: "Max results (default 20)" },
      },
      required: ["query"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "list_source_directory",
    description: "List directory contents at a specific version. Uses git ls-tree — works in production without source code.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path (default: root)" },
        version: { type: "string", description: "Git tag or ref (default: deployed version)" },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "compare_versions",
    description: "Show what changed between two versions — files modified, commit log. Uses git diff.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Starting version tag (e.g., 'v1.0.0')" },
        to: { type: "string", description: "Ending version tag (default: HEAD)" },
      },
      required: ["from"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
];

async function queryVersionHistoryHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const limit = typeof params.limit === "number" ? Math.min(params.limit, 50) : 20;
  const where = typeof params.digitalProductId === "string"
    ? { digitalProductId: params.digitalProductId }
    : {};

  const versions = await prisma.productVersion.findMany({
    where,
    orderBy: { shippedAt: "desc" },
    take: limit,
    include: {
      digitalProduct: { select: { productId: true, name: true } },
      promotions: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, promotionId: true } },
    },
  });

  const rows = versions.map((v) => ({
    product: v.digitalProduct?.name ?? "unknown",
    productId: v.digitalProduct?.productId ?? "unknown",
    version: v.version,
    gitTag: v.gitTag,
    shippedAt: v.shippedAt.toISOString(),
    changeCount: v.changeCount,
    changeSummary: v.changeSummary ?? "",
    promotionStatus: v.promotions[0]?.status ?? "none",
    promotionId: v.promotions[0]?.promotionId ?? null,
  }));

  const summary = rows.map((r) =>
    `${r.product} ${r.version} (${r.gitTag}) — ${r.promotionStatus} — shipped ${r.shippedAt.slice(0, 10)}`
  ).join("\n");

  return {
    success: true,
    message: summary || "No versions found.",
    data: { versions: rows },
  };
}

async function readSourceAtVersionHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { gitShow, isGitAvailable } = await import("@/lib/git-utils");
  if (!await isGitAvailable()) return { success: false, error: "Git history is not available in this deployment. Use read_codebase_manifest for codebase orientation.", message: "Git not available." };
  const ref = typeof params.version === "string" ? params.version : (process.env.DEPLOYED_VERSION ?? "HEAD");
  const result = await gitShow({ ref, path: String(params.path ?? "") });
  if ("error" in result) return { success: false, error: result.error, message: result.error };
  return { success: true, message: result.content, data: { content: result.content } };
}

async function searchSourceAtVersionHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { gitGrep, isGitAvailable } = await import("@/lib/git-utils");
  if (!await isGitAvailable()) return { success: false, error: "Git history is not available.", message: "Git not available." };
  const ref = typeof params.version === "string" ? params.version : (process.env.DEPLOYED_VERSION ?? "HEAD");
  const grepOpts: Parameters<typeof gitGrep>[0] = { query: String(params.query ?? ""), ref };
  if (typeof params.glob === "string") grepOpts.glob = params.glob;
  if (typeof params.maxResults === "number") grepOpts.maxResults = params.maxResults;
  const result = await gitGrep(grepOpts);
  const summary = result.results.map((r) => `${r.path}:${r.line}: ${r.text}`).join("\n");
  return { success: true, message: summary || "No matches found.", data: { results: result.results } };
}

async function listSourceDirectoryHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { gitLsTree, isGitAvailable } = await import("@/lib/git-utils");
  if (!await isGitAvailable()) return { success: false, error: "Git history is not available.", message: "Git not available." };
  const ref = typeof params.version === "string" ? params.version : (process.env.DEPLOYED_VERSION ?? "HEAD");
  const result = await gitLsTree({ ref, path: typeof params.path === "string" ? params.path : "" });
  const summary = result.entries.map((e) => `${e.type === "dir" ? "📁" : "📄"} ${e.path}`).join("\n");
  return { success: true, message: summary || "Empty directory.", data: { entries: result.entries } };
}

async function compareVersionsHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { gitDiffStat, isGitAvailable, gitLog } = await import("@/lib/git-utils");
  if (!await isGitAvailable()) return { success: false, error: "Git history is not available.", message: "Git not available." };
  const from = String(params.from ?? "");
  const to = typeof params.to === "string" ? params.to : "HEAD";
  const diff = await gitDiffStat({ from, to });
  const log = await gitLog({ from, to, maxCount: 20 });
  return {
    success: true,
    message: diff.summary,
    data: { filesChanged: diff.filesChanged, summary: diff.summary, commits: log.commits },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  query_version_history: (params) => queryVersionHistoryHandler(params),
  read_source_at_version: (params) => readSourceAtVersionHandler(params),
  search_source_at_version: (params) => searchSourceAtVersionHandler(params),
  list_source_directory: (params) => listSourceDirectoryHandler(params),
  compare_versions: (params) => compareVersionsHandler(params),
};

export const versionHistoryPack: ToolPack = {
  packId: "version-history",
  definitions,
  handlers,
  grants: {
    query_version_history: ["file_read"],
    read_source_at_version: ["file_read"],
    search_source_at_version: ["file_read"],
    list_source_directory: ["file_read"],
    compare_versions: ["file_read"],
  },
};
