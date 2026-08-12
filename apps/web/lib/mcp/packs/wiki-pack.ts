// Wiki tool pack — EP-8DC217EB BET-4.
//
// Drains the "wiki" domain out of the mcp-tools.ts executeTool switch: the tools
// a coworker uses to search the founder-kernel + per-org overlay wiki
// (wiki_query), run the lint detectors on demand (wiki_lint), and ingest a raw
// markdown source into the wiki via the extraction pipeline (wiki_ingest). Each
// handler reproduces the former switch case verbatim, so behaviour is identical
// when a tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source. All
// dynamic imports were already absolute (@/lib/... or @dpf/db) and are copied
// byte-for-byte; getCwd comes from the same shared lazy-node module the switch
// used.

import { getCwd } from "@/lib/shared/lazy-node";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "wiki_query",
    description:
      "Search the founder kernel + per-org overlay wiki for entity, stance, heuristic, principle, decision, summary, runbook, or index pages. " +
      "Use when the user asks about a DPF concept, what the founder's view is on something, what governance principles apply, or for grounded judgment on a question. " +
      "Returns top-K pages with slug, kind, kernel/overlay origin, content preview, and (for principle pages) tier + applies-to + dimensions + public-classification metadata. Prefer this over web speculation. " +
      "Call with a focused query once per question; refine from the returned pages rather than re-polling the same query. " +
      "Empty or low-relevance hits are a signal to rephrase, not to thrash identical calls.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for. Natural language; the wiki is embedded for semantic similarity." },
        pageKind: {
          type: "string",
          enum: ["entity", "summary", "decision", "runbook", "index", "stance", "heuristic", "principle"],
          description: "Optional filter to one page kind. Use 'stance' or 'heuristic' when the user wants judgment; 'principle' for governance rules with tier and applies-to; 'entity' for definitions; 'decision' for DEC-* records.",
        },
        tier: {
          type: "string",
          enum: ["commandment", "core", "contextual"],
          description: "When pageKind=principle: filter to one tier. Commandment = non-negotiable doctrine; core = strong defaults; contextual = narrow operational rules.",
        },
        appliesTo: {
          type: "string",
          enum: ["in_platform_coworker", "external_coding_agent", "human"],
          description: "When pageKind=principle: filter to principles that apply to this population.",
        },
        publicOnly: {
          type: "boolean",
          description: "When pageKind=principle: only return principles classified as public (safe to surface to customers / contributors).",
        },
        limit: { type: "number", description: "Max results (default 5)." },
        retrievalMode: {
          type: "string",
          enum: ["vector", "ppr"],
          description: "'vector' for cosine-only ranking (default — same as before). 'ppr' adds a Personalized PageRank pass over the per-org WikiPageLink subgraph so pages linked from the seed set also surface. Falls back to vector if the subgraph is sparse or PPR fails. Default: the org's wikiRetrievalMode setting, which is 'vector' until explicitly switched.",
        },
      },
      required: ["query"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "wiki_lint",
    description: "Run wiki lint detectors on-demand for the kernel and/or current organisation's overlay. Same orchestrator as the daily scheduled job. Use when the user asks to refresh findings or wants a quick health check. Returns scanned-page counts and finding deltas (opened / kept / resolved).",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["kernel", "org", "all"],
          description: "Which scope to lint. 'kernel' lints kernel rows only; 'org' lints the current org's overlay; 'all' (default) lints both.",
        },
      },
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "wiki_ingest",
    description:
      "Ingest a raw source (markdown file on disk) into the wiki: upsert the RawSource row, run the three-pass LLM extraction (abstract, claim, stance/heuristic), and optionally commit the proposal as draft overlay pages under the requesting org. Kernel pages stay PR-only (spec §4). Use when the user wants to import an article into the kernel knowledge surface, or to preview what the LLM would extract from a source without writing anything. Two modes: 'propose' returns the structured proposal for review without DB writes; 'commit' runs the full pipeline and lands drafts on /coworker-decisions?status=all.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description:
            "Absolute or process-relative path to the markdown source file. Files under docs/founder-kernel/raw-sources/ get sourceKey + sourceType derived from the path; for ad-hoc files outside that tree, pass sourceKey and sourceType explicitly.",
        },
        sourceKey: {
          type: "string",
          description:
            "Stable, idempotent key for the source (default: derived from filePath parent/stem). Re-ingesting the same key updates the existing RawSource row in place.",
        },
        sourceType: {
          type: "string",
          enum: ["paper", "article", "spec", "doc", "framework", "external-url"],
          description:
            "Source type override (default: derived from the parent directory name when it matches the registry).",
        },
        mode: {
          type: "string",
          enum: ["propose", "commit"],
          description:
            "'propose' returns the WikiDiffProposal without DB writes (good for human-in-the-loop review). 'commit' writes draft overlay pages and revisions. Default: 'propose'.",
        },
        acceptThreshold: {
          type: "number",
          description:
            "Minimum claim confidence to commit. Below this, claims are skipped (visible as skippedLowConfidence). Default 0.5. Ignored in propose mode.",
        },
        maxBodyDeltaRatio: {
          type: "number",
          description:
            "Cap on body growth per existing page in one commit cycle (default 0.3 = 30% per spec §6). Pages whose append would exceed the cap surface as errors instead of being auto-committed; the reviewer can resolve via manual edit.",
        },
        organizationId: {
          type: "string",
          description:
            "Org for the overlay commit. Default: the current session's org. Kernel-write attempts (organizationId resolves null) fail in commit mode.",
        },
      },
      required: ["filePath"],
    },
    requiredCapability: null,
    executionMode: "proposal",
    sideEffect: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
];

// ─── Handlers ───────────────────────────────────────────────────────────────

async function wikiQueryHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { searchWikiPages } = await import("@/lib/wiki/embeddings");
  const { prisma } = await import("@dpf/db");
  const org = await prisma.organization
    .findFirst({ select: { id: true, wikiRetrievalMode: true } })
    .catch(() => null);
  const organizationId = org?.id ?? null;

  // EP-WIKI-004 retrieval mode: the per-call override wins; otherwise
  // fall back to the org's wikiRetrievalMode setting; otherwise default
  // to vector. Principle filters and PPR aren't compatible (PPR seeds
  // from raw vector search; principle filters need the cosine-side
  // tier/applies-to gating), so if any principle filter is supplied we
  // force vector mode and let the caller know via the data shape.
  const callerMode = typeof params["retrievalMode"] === "string" ? params["retrievalMode"] : undefined;
  const principleFiltersPresent =
    typeof params["tier"] === "string" ||
    typeof params["appliesTo"] === "string" ||
    typeof params["publicOnly"] === "boolean";
  const orgMode = org?.wikiRetrievalMode === "ppr" ? "ppr" : "vector";
  const mode: "vector" | "ppr" = principleFiltersPresent
    ? "vector"
    : callerMode === "ppr" || callerMode === "vector"
    ? callerMode
    : orgMode;

  const limit = typeof params["limit"] === "number" ? params["limit"] : 5;

  if (mode === "ppr") {
    const { searchByPPR } = await import("@/lib/wiki/ppr");
    const results = await searchByPPR({
      query: String(params["query"] ?? ""),
      organizationId,
      limit,
      db: prisma,
    });
    if (results.length === 0) {
      return { success: true, message: "No matching wiki pages found.", data: { results: [], retrievalMode: mode } };
    }
    const summary = results
      .map((r) => {
        const tierFragment =
          r.pageKind === "principle" && r.principleTier ? `, ${r.principleTier}` : "";
        return `${r.slug} (${r.pageKind}, ${r.source}${tierFragment}) — ${r.title} (combined ${Math.round(r.combinedScore * 100)}%, cosine ${Math.round(r.cosineScore * 100)}%, PPR ${r.pprScore.toFixed(4)})`;
      })
      .join("\n");
    return { success: true, message: summary, data: { results, retrievalMode: mode } };
  }

  // Translate the ergonomic public schema fields (tier, appliesTo,
  // publicOnly) into canonical principle filter args. The public MCP
  // surface uses the short names so authors don't have to remember
  // "principleTier" / "principleAppliesTo" / "principlePublic"; the
  // canonical names live at the storage and retrieval layer per the
  // chief-architect review applied to the implementation plan.
  const searchArgs: Parameters<typeof searchWikiPages>[0] = {
    query: String(params["query"] ?? ""),
    organizationId,
    pageKind: typeof params["pageKind"] === "string" ? params["pageKind"] : undefined,
    limit,
  };
  if (typeof params["tier"] === "string") {
    searchArgs.principleTier = params["tier"];
  }
  if (typeof params["appliesTo"] === "string") {
    searchArgs.principleAppliesTo = params["appliesTo"];
  }
  if (typeof params["publicOnly"] === "boolean") {
    searchArgs.principlePublic = params["publicOnly"];
  }
  const results = await searchWikiPages(searchArgs);
  if (results.length === 0) {
    return { success: true, message: "No matching wiki pages found.", data: { results: [], retrievalMode: mode } };
  }
  const summary = results
    .map((r) => {
      const tierFragment =
        r.pageKind === "principle" && r.principleTier
          ? `, ${r.principleTier}`
          : "";
      return `${r.slug} (${r.pageKind}, ${r.source}${tierFragment}) — ${r.title} (${Math.round(r.score * 100)}% match)`;
    })
    .join("\n");
  return { success: true, message: summary, data: { results, retrievalMode: mode } };
}

async function wikiLintHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const { runWikiLint } = await import("@/lib/wiki/lint");
  const { prisma } = await import("@dpf/db");
  const scopeArg = typeof params["scope"] === "string" ? params["scope"] : "all";

  // Mirrors queue/functions/wiki-lint.ts: read manifest.json directly
  // rather than pulling in the seed module.
  const kernelVersion = await (async () => {
    try {
      const fsId = "fs/promises";
      const fs = await import(fsId);
      const pathId = "path";
      const path = await import(pathId);
      const manifestPath = path.join(getCwd(), "docs", "founder-kernel", "manifest.json");
      const raw = await fs.readFile(manifestPath, "utf8");
      return (JSON.parse(raw) as { kernelVersion?: string }).kernelVersion ?? "0.0.0";
    } catch {
      return "0.0.0";
    }
  })();

  const org = await prisma.organization
    .findFirst({ select: { id: true } })
    .catch(() => null);

  const runs: Array<Awaited<ReturnType<typeof runWikiLint>>> = [];
  if (scopeArg === "kernel" || scopeArg === "all") {
    runs.push(
      await runWikiLint({
        organizationId: null,
        prisma: prisma as never,
        currentKernelVersion: kernelVersion,
      }),
    );
  }
  if ((scopeArg === "org" || scopeArg === "all") && org) {
    runs.push(
      await runWikiLint({
        organizationId: org.id,
        prisma: prisma as never,
        currentKernelVersion: kernelVersion,
      }),
    );
  }

  if (runs.length === 0) {
    return {
      success: true,
      message: "No scope linted (no organisation found and scope was 'org').",
      data: { runs: [] },
    };
  }

  const summary = runs
    .map((r) => {
      const tag = r.organizationId === null ? "kernel" : `org ${r.organizationId}`;
      return `${tag}: scanned=${r.scannedPageCount} opened=${r.findingsOpened} kept=${r.findingsKept} resolved=${r.findingsResolved}`;
    })
    .join("\n");

  return { success: true, message: summary, data: { runs } };
}

async function wikiIngestHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  // Phase 2.3b — glue 2.1 source ingest + 2.2 proposal engine +
  // 2.3a commit step into one MCP-callable action. Production
  // inference adapter wraps utilityInfer (pass 1) + routeAndCall
  // (passes 2 + 3); the InferenceCallable injection lets tests
  // stub deterministically.
  const filePath = typeof params["filePath"] === "string" ? params["filePath"] : null;
  if (!filePath) {
    return {
      success: false,
      message: "wiki_ingest requires `filePath`.",
      error: "Missing filePath",
    };
  }
  // CodeQL #62 (js/path-injection): filePath is MCP-supplied (user-
  // controlled). Gate to the allowed source roots before fs is touched.
  const { assertAllowedIngestPath } = await import("@/lib/wiki/ingest");
  let safeFilePath: string;
  try {
    safeFilePath = assertAllowedIngestPath(filePath);
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "filePath rejected",
      error: "path_not_allowed",
    };
  }
  const mode = typeof params["mode"] === "string" && params["mode"] === "commit" ? "commit" : "propose";
  const sourceKey = typeof params["sourceKey"] === "string" ? params["sourceKey"] : undefined;
  const sourceType = typeof params["sourceType"] === "string" ? params["sourceType"] : undefined;
  const acceptThreshold =
    typeof params["acceptThreshold"] === "number" ? params["acceptThreshold"] : undefined;
  const maxBodyDeltaRatio =
    typeof params["maxBodyDeltaRatio"] === "number" ? params["maxBodyDeltaRatio"] : undefined;

  const { prisma } = await import("@dpf/db");
  const orgIdParam = typeof params["organizationId"] === "string" ? params["organizationId"] : null;
  let organizationId: string | null = orgIdParam;
  if (!organizationId) {
    const currentOrg = await prisma.organization
      .findFirst({ select: { id: true } })
      .catch(() => null);
    organizationId = currentOrg?.id ?? null;
  }
  if (mode === "commit" && !organizationId) {
    return {
      success: false,
      message:
        "wiki_ingest mode=commit requires an organizationId — kernel pages are PR-only (spec §4). Run in mode=propose instead, or supply an organizationId.",
      error: "Kernel write refused",
    };
  }

  const { runIngestPipeline, summarizePipelineResult } = await import(
    "@/lib/wiki/ingest-pipeline"
  );
  const { createProductionInference } = await import(
    "@/lib/wiki/inference-adapter"
  );

  // Pull kernel version from the manifest for the audit row.
  const kernelVersion = await (async () => {
    try {
      const fsId = "fs/promises";
      const fs = await import(fsId);
      const pathId = "path";
      const path = await import(pathId);
      const manifestPath = path.join(
        getCwd(),
        "docs",
        "founder-kernel",
        "manifest.json",
      );
      const raw = await fs.readFile(manifestPath, "utf8");
      return (JSON.parse(raw) as { kernelVersion?: string }).kernelVersion ?? null;
    } catch {
      return null;
    }
  })();

  // sourceType must be one of the registry values when supplied; the
  // pipeline rejects unknown strings, so we pass through whatever the
  // caller gave us and let the source-layer surface the error.
  const sourceInput = {
    filePath: safeFilePath,
    ...(sourceKey ? { sourceKey } : {}),
    ...(sourceType
      ? {
          sourceType: sourceType as
            | "paper"
            | "article"
            | "spec"
            | "doc"
            | "framework"
            | "external-url",
        }
      : {}),
    organizationId: mode === "commit" ? organizationId : null,
    isKernel: false,
    kernelVersion,
  };

  try {
    const result = await runIngestPipeline({
      source: sourceInput,
      organizationId: mode === "commit" ? organizationId : null,
      mode,
      infer: createProductionInference({ taskType: "wiki_proposal" }),
      ...(acceptThreshold !== undefined ? { acceptThreshold } : {}),
      ...(maxBodyDeltaRatio !== undefined ? { maxBodyDeltaRatio } : {}),
    });
    return {
      success: true,
      message: summarizePipelineResult(result),
      data: result,
    };
  } catch (err) {
    return {
      success: false,
      message: `wiki_ingest failed: ${(err as Error).message ?? String(err)}`,
      error: (err as Error).message ?? String(err),
    };
  }
}

const handlers: Record<string, ToolPackHandler> = {
  wiki_query: (params) => wikiQueryHandler(params),
  wiki_lint: (params) => wikiLintHandler(params),
  wiki_ingest: (params) => wikiIngestHandler(params),
};

export const wikiPack: ToolPack = {
  packId: "wiki",
  definitions,
  handlers,
  grants: {
    wiki_query: ["registry_read"],
    wiki_lint: ["registry_read"],
    wiki_ingest: ["registry_write"],
  },
};
