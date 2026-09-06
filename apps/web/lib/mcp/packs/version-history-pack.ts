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
import { createHash } from "node:crypto";

// BI-8B8731EE: a governed reviewer gets a bounded number of immutable reads
// (terminal-tool-policy maximumReaderCalls = 6) before it must write its
// receipt. At 40 lines / 3,000 chars a page that is ~19 KB of artifact, and a
// 25 KB design spec ran every reviewer out of budget four times in one night
// without a verdict. A default page now carries a whole medium document, and
// the cap allows a long one in two or three reads. Pages stay bounded: this
// is still a paged reader, not a whole-file dump.
const DEFAULT_READ_MAX_LINES = 200;
const MAX_READ_LINES = 400;
const DEFAULT_READ_MAX_CHARS = 12_000;
const MAX_READ_CHARS = 16_000;
const DEFAULT_SEARCH_RESULTS = 20;
const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCH_OFFSET = 2_000;

type ReadCursor = { v: 1; offset: number; binding: string };
type SourcePage = {
  path: string;
  version: string;
  blobId: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  hasMore: boolean;
  nextCursor: string | null;
};

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function blobBinding(ref: string, path: string, blobId: string): string {
  return createHash("sha256").update(`${ref}\0${path}\0${blobId}`).digest("hex");
}

function encodeReadCursor(cursor: ReadCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeReadCursor(value: unknown, binding: string): ReadCursor | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ReadCursor>;
    return parsed.v === 1
      && Number.isSafeInteger(parsed.offset)
      && (parsed.offset ?? -1) >= 0
      && parsed.binding === binding
      ? parsed as ReadCursor
      : null;
  } catch {
    return null;
  }
}

function countSourceLines(content: string): number {
  if (content.length === 0) return 0;
  const newlines = content.match(/\n/g)?.length ?? 0;
  return newlines + (content.endsWith("\n") ? 0 : 1);
}

function offsetForLine(content: string, line: number): number | null {
  if (line <= 1) return 0;
  let current = 1;
  for (let index = 0; index < content.length; index++) {
    if (content[index] !== "\n") continue;
    current++;
    if (current === line) return index + 1;
  }
  return null;
}

function lineAtOffset(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < Math.min(offset, content.length); index++) {
    if (content[index] === "\n") line++;
  }
  return line;
}

function endOffsetForLines(content: string, offset: number, maxLines: number): number {
  let lines = 0;
  for (let index = offset; index < content.length; index++) {
    if (content[index] !== "\n") continue;
    lines++;
    if (lines === maxLines) return index + 1;
  }
  return content.length;
}

function pageSource(input: {
  content: string;
  ref: string;
  path: string;
  blobId: string;
  cursor?: unknown;
  startLine?: unknown;
  maxLines?: unknown;
  maxChars?: unknown;
}): { error: string } | SourcePage {
  const binding = blobBinding(input.ref, input.path, input.blobId);
  const decoded = input.cursor === undefined ? null : decodeReadCursor(input.cursor, binding);
  if (input.cursor !== undefined && !decoded) return { error: "invalid_cursor" };
  const requestedLine = boundedInteger(input.startLine, 1, 1, Number.MAX_SAFE_INTEGER);
  const startOffset = decoded?.offset ?? offsetForLine(input.content, requestedLine);
  if (startOffset === null || startOffset > input.content.length) return { error: "invalid_source_range" };
  const maxLines = boundedInteger(input.maxLines, DEFAULT_READ_MAX_LINES, 1, MAX_READ_LINES);
  const maxChars = boundedInteger(input.maxChars, DEFAULT_READ_MAX_CHARS, 1, MAX_READ_CHARS);
  const endOffset = Math.min(
    input.content.length,
    startOffset + maxChars,
    endOffsetForLines(input.content, startOffset, maxLines),
  );
  const content = input.content.slice(startOffset, endOffset);
  const startLine = lineAtOffset(input.content, startOffset);
  const newlineCount = content.match(/\n/g)?.length ?? 0;
  const endLine = content.length === 0
    ? Math.max(0, startLine - 1)
    : startLine + newlineCount - (content.endsWith("\n") ? 1 : 0);
  const hasMore = endOffset < input.content.length;
  return {
    path: input.path,
    version: input.ref,
    blobId: input.blobId,
    content,
    startLine,
    endLine,
    totalLines: countSourceLines(input.content),
    hasMore,
    nextCursor: hasMore
      ? encodeReadCursor({ v: 1, offset: endOffset, binding })
      : null,
  };
}

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
    description: "Read a bounded page of a file at an immutable version. Continue with nextCursor or jump with startLine. Uses git history and works without a source checkout.",
    inputSchema: {
      type: "object",
      properties: {
        repositoryFullName: { type: "string", description: "Canonical repository owner/name for immutable provider fallback" },
        path: { type: "string", description: "Relative file path" },
        version: { type: "string", description: "Git tag or ref (default: deployed version)" },
        startLine: { type: "number", description: "1-based line to start at (default 1)" },
        cursor: { type: "string", description: "Opaque nextCursor from the prior page; overrides startLine" },
        maxLines: { type: "number", description: `Maximum lines in one page (default ${DEFAULT_READ_MAX_LINES}, max ${MAX_READ_LINES})` },
        maxChars: { type: "number", description: `Maximum source characters in one page (default ${DEFAULT_READ_MAX_CHARS}, max ${MAX_READ_CHARS})` },
        expectedBlobId: { type: "string", description: "Expected immutable git blob id; mismatch fails closed" },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    retainAuditParameters: true,
  },
  {
    name: "search_source_at_version",
    description: "Search source at an immutable version with bounded, offset-based continuation. Uses git grep and works without a source checkout.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regex pattern to search" },
        version: { type: "string", description: "Git tag or ref (default: deployed version)" },
        glob: { type: "string", description: "File glob filter (e.g., '*.ts')" },
        maxResults: { type: "number", description: "Max results (default 20)" },
        offset: { type: "number", description: `Result offset for continuation (default 0, max ${MAX_SEARCH_OFFSET})` },
        expectedBlobId: { type: "string", description: "Expected blob id when glob names one exact file; mismatch fails closed" },
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
  const { gitBlobId, gitShow, isGitAvailable } = await import("@/lib/git-utils");
  const gitUnavailable = "Git history is not available in this deployment. Use read_codebase_manifest for codebase orientation.";
  const ref = typeof params.version === "string" ? params.version : (process.env.DEPLOYED_VERSION ?? "HEAD");
  const path = String(params.path ?? "");
  const repositoryFullName = typeof params.repositoryFullName === "string" ? params.repositoryFullName : null;
  const expectedBlobId = typeof params.expectedBlobId === "string" ? params.expectedBlobId : null;
  const providerBound = repositoryFullName !== null
    && expectedBlobId !== null
    && /^[a-f0-9]{40}$/i.test(ref)
    && /^[a-f0-9]{40}$/i.test(expectedBlobId);

  let content: string | null = null;
  let blobId: string | null = null;
  let localError = gitUnavailable;
  if (await isGitAvailable()) {
    const resolvedBlob = await gitBlobId({ ref, path });
    if (!("error" in resolvedBlob)) {
      if (expectedBlobId !== null && expectedBlobId !== resolvedBlob.blobId) {
        return {
          success: false,
          error: "immutable_blob_mismatch",
          message: `Expected blob ${expectedBlobId}, but ${ref}:${path} resolved to ${resolvedBlob.blobId}.`,
        };
      }
      const result = await gitShow({ ref, path });
      if (!("error" in result)) {
        content = result.content;
        blobId = resolvedBlob.blobId;
      } else {
        localError = result.error;
      }
    } else {
      localError = resolvedBlob.error;
    }
  }

  if (content === null || blobId === null) {
    if (!providerBound) {
      return {
        success: false,
        error: localError,
        message: localError === gitUnavailable ? "Git not available." : localError,
      };
    }
    const { readRepositoryProviderBlob } = await import("@/lib/backlog/initiative-readiness/repository-artifact");
    const providerBlob = await readRepositoryProviderBlob({
      repositoryFullName,
      commitSha: ref,
      path,
      expectedBlobId,
    });
    if (!providerBlob.ok) return { success: false, error: providerBlob.code, message: providerBlob.error };
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(providerBlob.data);
    } catch {
      return { success: false, error: "IMMUTABLE_SOURCE_NOT_UTF8", message: "Repository artifact is not valid UTF-8 source text." };
    }
    blobId = expectedBlobId;
  }
  const page = pageSource({
    content,
    ref,
    path,
    blobId,
    cursor: params.cursor,
    startLine: params.startLine,
    maxLines: params.maxLines,
    maxChars: params.maxChars,
  });
  if ("error" in page) return { success: false, error: page.error, message: page.error };
  const { startLine, endLine, totalLines } = page;
  const more = page.hasMore ? " (more available)" : "";
  return {
    success: true,
    message: `Read ${path} lines ${startLine}-${endLine} of ${totalLines} at ${ref}${more}.`,
    data: { ...page, ...(repositoryFullName ? { repositoryFullName } : {}) },
  };
}

async function searchSourceAtVersionHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { gitBlobId, gitGrep, isGitAvailable } = await import("@/lib/git-utils");
  if (!await isGitAvailable()) return { success: false, error: "Git history is not available.", message: "Git not available." };
  const ref = typeof params.version === "string" ? params.version : (process.env.DEPLOYED_VERSION ?? "HEAD");
  const offset = boundedInteger(params.offset, 0, 0, MAX_SEARCH_OFFSET);
  if (typeof params.offset === "number" && params.offset > MAX_SEARCH_OFFSET) {
    return { success: false, error: "invalid_search_offset", message: `Search offset exceeds ${MAX_SEARCH_OFFSET}.` };
  }
  const maxResults = boundedInteger(params.maxResults, DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS);
  let blobId: string | null = null;
  if (typeof params.expectedBlobId === "string") {
    if (typeof params.glob !== "string" || /[*?\[]/.test(params.glob)) {
      return { success: false, error: "expected_blob_requires_exact_path", message: "expectedBlobId requires glob to name one exact source path." };
    }
    const resolvedBlob = await gitBlobId({ ref, path: params.glob });
    if ("error" in resolvedBlob) return { success: false, error: resolvedBlob.error, message: resolvedBlob.error };
    blobId = resolvedBlob.blobId;
    if (blobId !== params.expectedBlobId) {
      return { success: false, error: "immutable_blob_mismatch", message: `Expected blob ${params.expectedBlobId}, but ${ref}:${params.glob} resolved to ${blobId}.` };
    }
  }
  const grepOpts: Parameters<typeof gitGrep>[0] = { query: String(params.query ?? ""), ref };
  if (typeof params.glob === "string") grepOpts.glob = params.glob;
  grepOpts.maxResults = offset + maxResults + 1;
  const result = await gitGrep(grepOpts);
  const page = result.results.slice(offset, offset + maxResults);
  const hasMore = result.results.length > offset + maxResults;
  return {
    success: true,
    message: page.length === 0
      ? `No matches found at ${ref}.`
      : `Found ${page.length} matches at ${ref}${hasMore ? " (more available)" : ""}.`,
    data: {
      results: page,
      version: ref,
      ...(typeof params.glob === "string" ? { glob: params.glob } : {}),
      ...(blobId ? { blobId } : {}),
      offset,
      hasMore,
      nextOffset: hasMore ? offset + page.length : null,
    },
  };
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
