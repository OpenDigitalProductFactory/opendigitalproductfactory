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

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tool-types";
import type { RepositorySourceAdmission } from "@/lib/backlog/initiative-readiness/repository-artifact";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { pageSource, boundedInteger } from "@/lib/source-page";
import { REPO_COMMIT_RANGE_PATH_PREFIX } from "@/lib/shared/immutable-review-reader";
import {
  SOURCE_READ_DEFAULT_MAX_CHARS,
  SOURCE_READ_DEFAULT_MAX_LINES,
  SOURCE_READ_MAX_CHARS,
  SOURCE_READ_MAX_LINES,
} from "@/lib/source-page-lines";

// BI-8B8731EE: a governed reviewer gets a bounded number of immutable reads
// (terminal-tool-policy maximumReaderCalls = 6) before it must write its
// receipt. At 40 lines / 3,000 chars a page that is ~19 KB of artifact, and a
// 25 KB design spec ran every reviewer out of budget four times in one night
// without a verdict. A default page now carries a whole medium document, and
// the cap allows a long one in two or three reads. Pages stay bounded: this
// is still a paged reader, not a whole-file dump.
const DEFAULT_READ_MAX_LINES = SOURCE_READ_DEFAULT_MAX_LINES;
const MAX_READ_LINES = SOURCE_READ_MAX_LINES;
const DEFAULT_READ_MAX_CHARS = SOURCE_READ_DEFAULT_MAX_CHARS;
const MAX_READ_CHARS = SOURCE_READ_MAX_CHARS;
const DEFAULT_SEARCH_RESULTS = 20;
const MAX_SEARCH_RESULTS = 50;
const MAX_SEARCH_OFFSET = 2_000;

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
    description: "Read a bounded page at an immutable version. Continue with nextCursor or jump with startLine. Git history works without a source checkout. An initiative-body-version path reads retained criteria only for its exact authorized acceptance TaskRun. A repo-commit-range path reads a whole merged change (file list and diff) and requires its bound change digest as expectedBlobId.",
    inputSchema: {
      type: "object",
      properties: {
        repositoryFullName: { type: "string", description: "Canonical repository owner/name for immutable provider fallback" },
        workroomId: { type: "string", description: "Optional exact actor-admitted Workroom selecting public component source; requires its current commit and expected blob." },
        path: { type: "string", description: "Relative file path" },
        version: { type: "string", description: "Git tag or ref (default: deployed version)" },
        startLine: { type: "number", description: "1-based line to start at (default 1)" },
        cursor: { type: "string", description: "Opaque nextCursor from the prior page; overrides startLine" },
        maxLines: { type: "number", description: `Maximum lines in one page (default ${DEFAULT_READ_MAX_LINES}, max ${MAX_READ_LINES})` },
        maxChars: { type: "number", description: `Maximum source characters in one page (default ${DEFAULT_READ_MAX_CHARS}, max ${MAX_READ_CHARS})` },
        expectedBlobId: { type: "string", description: "Expected immutable git blob id or bound criteria digest; mismatch fails closed" },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    retainAuditParameters: true,
  },
  {
    // BI-926A7E90: a Build Studio design is an accepted BuildArtifactRevision,
    // not a repository blob. This reader serves it with the same page shape and
    // the same four identity keys as read_source_at_version, so the governed
    // reviewer's terminal policy binds and verifies it the same way.
    name: "read_build_artifact_revision",
    description: "Read a bounded page of an accepted Build Studio artifact revision at its immutable identity. path is build-artifact-revision/<revisionId>, version is the revision id, expectedBlobId is its value digest. Continue with nextCursor or jump with startLine.",
    inputSchema: {
      type: "object",
      properties: {
        repositoryFullName: { type: "string", description: "Canonical repository owner/name the Workroom is bound to" },
        path: { type: "string", description: "build-artifact-revision/<revisionId>" },
        version: { type: "string", description: "The BuildArtifactRevision id" },
        startLine: { type: "number", description: "1-based line to start at (default 1)" },
        cursor: { type: "string", description: "Opaque nextCursor from the prior page; overrides startLine" },
        maxLines: { type: "number", description: `Maximum lines in one page (default ${DEFAULT_READ_MAX_LINES}, max ${MAX_READ_LINES})` },
        maxChars: { type: "number", description: `Maximum source characters in one page (default ${DEFAULT_READ_MAX_CHARS}, max ${MAX_READ_CHARS})` },
        expectedBlobId: { type: "string", description: "Expected value digest of the revision; mismatch fails closed" },
      },
      required: ["path", "version", "expectedBlobId"],
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
        repositoryFullName: { type: "string", description: "Canonical repository owner/name for immutable provider fallback" },
        workroomId: { type: "string", description: "Optional exact actor-admitted Workroom selecting public component source; requires one exact path, current commit and expected blob." },
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

async function readSourceAtVersionHandler(params: Record<string, unknown>, sourceAdmission?: RepositorySourceAdmission): Promise<ToolResult> {
  const { gitBlobId, gitShow, isGitAvailable } = await import("@/lib/git-utils");
  const gitUnavailable = "Git history is not available in this deployment. Use read_codebase_manifest for codebase orientation.";
  const ref = typeof params.version === "string" ? params.version : (process.env.DEPLOYED_VERSION ?? "HEAD");
  const path = String(params.path ?? "");
  const repositoryFullName = typeof params.repositoryFullName === "string" ? params.repositoryFullName : null;
  const expectedBlobId = typeof params.expectedBlobId === "string" ? params.expectedBlobId : null;
  const { isCanonicalRepositorySource } = await import("@/lib/backlog/initiative-readiness/repository-artifact");
  const canonical = repositoryFullName === null || await isCanonicalRepositorySource(repositoryFullName);
  if ((!canonical && !sourceAdmission) || (sourceAdmission && (!repositoryFullName
    || sourceAdmission.repositoryFullName.toLowerCase() !== repositoryFullName.toLowerCase()
    || sourceAdmission.headSha !== ref || !expectedBlobId || !await sourceAdmission.isCurrent()))) {
    return { success: false, error: "workroom_source_unavailable", message: "The exact selected repository source or actor admission could not be verified." };
  }
  // The provider fallback needs the canonical repository and an immutable
  // commit. The blob id is verification when the caller has one (a bound review
  // packet), not a precondition: a caller that knows only commit + path — a
  // reviewer reached over native MCP, which never sees the bound schema — is
  // still asking for an immutable artifact.
  const isSha = (value: string) => /^[a-f0-9]{40}$/i.test(value);
  const providerBound = repositoryFullName !== null
    && isSha(ref)
    && (expectedBlobId === null || isSha(expectedBlobId));
  const providerInputsMissing = (): string => {
    const missing: string[] = [];
    if (repositoryFullName === null) missing.push("repositoryFullName (the canonical repository owner/name)");
    if (!isSha(ref)) missing.push("version as the 40-character commit sha");
    if (expectedBlobId !== null && !isSha(expectedBlobId)) missing.push("expectedBlobId as a 40-character blob sha, or omit it");
    return `This deployment's git volume does not hold ${ref}:${path}. The repository provider serves any commit + path; pass ${missing.join(" and ")} to read it.`;
  };

  let content: string | null = null;
  let blobId: string | null = null;
  let localError = gitUnavailable;
  if (canonical && !sourceAdmission && await isGitAvailable()) {
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
      return { success: false, error: localError, message: providerInputsMissing() };
    }
    const { readRepositoryProviderBlob } = await import("@/lib/backlog/initiative-readiness/repository-artifact");
    const providerBlob = await readRepositoryProviderBlob({
      repositoryFullName,
      commitSha: ref,
      path,
      expectedBlobId,
      ...(sourceAdmission ? { sourceAdmission } : {}),
    });
    if (!providerBlob.ok) return { success: false, error: providerBlob.code, message: providerBlob.error };
    blobId = providerBlob.blobId;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(providerBlob.data);
    } catch {
      return { success: false, error: "IMMUTABLE_SOURCE_NOT_UTF8", message: "Repository artifact is not valid UTF-8 source text." };
    }
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

const BUILD_ARTIFACT_REVISION_PATH_PREFIX = "build-artifact-revision/";

async function readBuildArtifactRevisionHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const path = String(params.path ?? "");
  const version = typeof params.version === "string" ? params.version.trim() : "";
  const expectedBlobId = typeof params.expectedBlobId === "string" ? params.expectedBlobId.trim() : "";
  const repositoryFullName = typeof params.repositoryFullName === "string" ? params.repositoryFullName : null;
  const revisionId = path.startsWith(BUILD_ARTIFACT_REVISION_PATH_PREFIX) ? path.slice(BUILD_ARTIFACT_REVISION_PATH_PREFIX.length) : "";
  if (!revisionId || revisionId !== version) {
    return {
      success: false,
      error: "invalid_revision_identity",
      message: `path must be ${BUILD_ARTIFACT_REVISION_PATH_PREFIX}<revisionId> and version must be that same revision id.`,
    };
  }
  if (!expectedBlobId) {
    return { success: false, error: "expected_blob_required", message: "expectedBlobId (the revision's value digest) is required." };
  }
  const { prisma } = await import("@dpf/db");
  const revision = await prisma.buildArtifactRevision.findUnique({
    where: { id: revisionId },
    select: { id: true, buildId: true, field: true, revisionNumber: true, status: true, valueDigest: true, value: true },
  });
  if (!revision) {
    return { success: false, error: "IMMUTABLE_SOURCE_UNAVAILABLE", message: `No Build Studio artifact revision ${revisionId} exists.` };
  }
  // The install stores the digest as bare hex while receipts carry it as
  // `sha256:<hex>`; a binding may arrive in either form. Compare the hex and
  // echo the BOUND form, since the terminal policy checks the page's blobId
  // against the binding it issued.
  const bareHex = (value: string) => value.replace(/^sha256:/i, "").toLowerCase();
  if (bareHex(revision.valueDigest) !== bareHex(expectedBlobId)) {
    return {
      success: false,
      error: "immutable_blob_mismatch",
      message: `Expected value digest ${expectedBlobId}, but revision ${revisionId} carries ${revision.valueDigest}.`,
    };
  }
  const { initiativeTextFromBuildValue } = await import("@/lib/backlog/initiative-readiness/artifact-resolver");
  const content = initiativeTextFromBuildValue(revision.value);
  if (content === null) {
    return { success: false, error: "IMMUTABLE_SOURCE_NOT_TEXT", message: "The revision value does not render as reviewable text." };
  }
  const page = pageSource({
    content,
    ref: version,
    path,
    blobId: expectedBlobId,
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
    message: `Read ${revision.field} revision ${revision.revisionNumber} of ${revision.buildId} (${revision.status}) lines ${startLine}-${endLine} of ${totalLines}${more}.`,
    data: {
      ...page,
      ...(repositoryFullName ? { repositoryFullName } : {}),
      buildId: revision.buildId,
      field: revision.field,
      revisionNumber: revision.revisionNumber,
      status: revision.status,
    },
  };
}

async function searchSourceAtVersionHandler(params: Record<string, unknown>, sourceAdmission?: RepositorySourceAdmission): Promise<ToolResult> {
  const { gitBlobId, gitGrep, isGitAvailable } = await import("@/lib/git-utils");
  const ref = typeof params.version === "string" ? params.version : (process.env.DEPLOYED_VERSION ?? "HEAD");
  const repositoryFullName = typeof params.repositoryFullName === "string" ? params.repositoryFullName : null;
  const glob = typeof params.glob === "string" ? params.glob : null;
  const expectedBlobId = typeof params.expectedBlobId === "string" ? params.expectedBlobId : null;
  const exactPath = glob !== null && !/[*?\[]/.test(glob);
  const { isCanonicalRepositorySource } = await import("@/lib/backlog/initiative-readiness/repository-artifact");
  const canonical = repositoryFullName === null || await isCanonicalRepositorySource(repositoryFullName);
  if ((!canonical && !sourceAdmission) || (sourceAdmission && (!repositoryFullName || !exactPath || !expectedBlobId
    || sourceAdmission.repositoryFullName.toLowerCase() !== repositoryFullName.toLowerCase()
    || sourceAdmission.headSha !== ref || !await sourceAdmission.isCurrent()))) {
    return { success: false, error: "workroom_source_unavailable", message: "The exact selected repository source or actor admission could not be verified." };
  }
  const offset = boundedInteger(params.offset, 0, 0, MAX_SEARCH_OFFSET);
  if (typeof params.offset === "number" && params.offset > MAX_SEARCH_OFFSET) {
    return { success: false, error: "invalid_search_offset", message: `Search offset exceeds ${MAX_SEARCH_OFFSET}.` };
  }
  const maxResults = boundedInteger(params.maxResults, DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS);
  let blobId: string | null = null;
  if (expectedBlobId !== null) {
    if (!exactPath) {
      return { success: false, error: "expected_blob_requires_exact_path", message: "expectedBlobId requires glob to name one exact source path." };
    }
  }
  let results: Array<{ path: string; line: number; text: string }>;
  if (canonical && !sourceAdmission && await isGitAvailable()) {
    if (expectedBlobId !== null) {
      const resolvedBlob = await gitBlobId({ ref, path: glob! });
      if ("error" in resolvedBlob) return { success: false, error: resolvedBlob.error, message: resolvedBlob.error };
      blobId = resolvedBlob.blobId;
      if (blobId !== expectedBlobId) {
        return { success: false, error: "immutable_blob_mismatch", message: `Expected blob ${expectedBlobId}, but ${ref}:${glob} resolved to ${blobId}.` };
      }
    }
    const grepOpts: Parameters<typeof gitGrep>[0] = { query: String(params.query ?? ""), ref };
    if (glob !== null) grepOpts.glob = glob;
    grepOpts.maxResults = offset + maxResults + 1;
    results = (await gitGrep(grepOpts)).results;
  } else {
    const isSha = /^[a-f0-9]{40}$/i.test(ref);
    if (!repositoryFullName || !isSha || !exactPath) {
      const missing = [
        ...(!repositoryFullName ? ["repositoryFullName"] : []),
        ...(!isSha ? ["version as a 40-character commit sha"] : []),
        ...(!exactPath ? ["glob naming one exact source path"] : []),
      ];
      return {
        success: false,
        error: "immutable_search_locator_required",
        message: `This deployment needs ${missing.join(", ")} to search immutable source through the repository provider.`,
      };
    }
    const { readRepositoryProviderBlob } = await import("@/lib/backlog/initiative-readiness/repository-artifact");
    const providerBlob = await readRepositoryProviderBlob({
      repositoryFullName,
      commitSha: ref,
      path: glob,
      expectedBlobId,
      ...(sourceAdmission ? { sourceAdmission } : {}),
    });
    if (!providerBlob.ok) return { success: false, error: providerBlob.code, message: providerBlob.error };
    blobId = providerBlob.blobId;
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(providerBlob.data);
    } catch {
      return { success: false, error: "IMMUTABLE_SOURCE_NOT_UTF8", message: "Repository artifact is not valid UTF-8 source text." };
    }
    let pattern: RegExp;
    try {
      pattern = new RegExp(String(params.query ?? ""));
    } catch {
      return { success: false, error: "invalid_search_pattern", message: "Search pattern is not a valid regular expression." };
    }
    results = content.split(/\r?\n/).flatMap((text, index) => pattern.test(text)
      ? [{ path: glob, line: index + 1, text }]
      : []);
  }
  const page = results.slice(offset, offset + maxResults);
  const hasMore = results.length > offset + maxResults;
  return {
    success: true,
    message: page.length === 0
      ? `No matches found at ${ref}.`
      : `Found ${page.length} matches at ${ref}${hasMore ? " (more available)" : ""}.`,
    data: {
      results: page,
      version: ref,
      ...(glob !== null ? { glob } : {}),
      ...(repositoryFullName ? { repositoryFullName } : {}),
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
  read_source_at_version: (params, userId, context) => String(params.path ?? "").startsWith("initiative-body-version/")
    ? import("@/lib/backlog/initiative-readiness/body-baseline-reader").then(({ readInitiativeBodyVersion }) => readInitiativeBodyVersion(params, userId, context))
    // BI-46E344FE: a merged change bound whole to a post-implementation review.
    : String(params.path ?? "").startsWith(REPO_COMMIT_RANGE_PATH_PREFIX)
    ? import("@/lib/backlog/initiative-readiness/repo-commit-range").then(({ readCommitRangeAtVersion }) => readCommitRangeAtVersion(params))
    : selectedSourceHandler(params, userId, context, readSourceAtVersionHandler),
  read_build_artifact_revision: (params) => readBuildArtifactRevisionHandler(params),
  search_source_at_version: (params, userId, context) => selectedSourceHandler(params, userId, context, searchSourceAtVersionHandler),
  list_source_directory: (params) => listSourceDirectoryHandler(params),
  compare_versions: (params) => compareVersionsHandler(params),
};

async function selectedSourceHandler(params: Record<string, unknown>, userId: string,
  context: Parameters<ToolPackHandler>[2], handler: typeof readSourceAtVersionHandler) {
  if (params.workroomId === undefined) return handler(params);
  const { prepareWorkroomRepositorySource } = await import("../workroom-repository-source");
  const selected = await prepareWorkroomRepositorySource({ workroomId: params.workroomId, userId, agentId: context?.agentId ?? null });
  if (!selected) return { success: false, error: "workroom_source_unavailable", message: "The exact Workroom source or actor admission could not be verified." };
  const result = await handler(params, selected.sourceAdmission);
  return await selected.sourceAdmission.isCurrent() ? result
    : { success: false, error: "workroom_source_unavailable", message: "The selected source or actor admission changed during the read." };
}

export const versionHistoryPack: ToolPack = {
  packId: "version-history",
  definitions,
  handlers,
  grants: {
    query_version_history: ["file_read"],
    read_source_at_version: ["file_read"],
    read_build_artifact_revision: ["file_read"],
    search_source_at_version: ["file_read"],
    list_source_directory: ["file_read"],
    compare_versions: ["file_read"],
  },
};
