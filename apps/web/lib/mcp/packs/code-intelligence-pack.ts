// Code-intelligence tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the read-only code-intelligence domain out of the mcp-tools.ts
// executeTool switch: searching design specs and implementation plans, checking
// the committed source-code graph's freshness, searching that graph, tracing a
// route/tool/model to its implementation files, finding a file's related tests,
// and scoring a feature's reusability. Each handler lazy-imports its single
// backing service and reproduces the former switch case verbatim, so behaviour
// is identical when the tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source. The
// three code-graph read tools shared one local result-shaping helper in
// mcp-tools.ts (codeGraphReadToolResult); it moves here with them.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

/** Coerce an optional string param, trimming and nulling empties. */
function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Shape a code-graph query result into a ToolResult, surfacing unavailability. */
function codeGraphReadToolResult(
  result: Record<string, unknown> & { available?: unknown; summary?: unknown },
): ToolResult {
  const message = typeof result.summary === "string" && result.summary.trim()
    ? result.summary
    : "Code graph query completed.";
  if (result.available === false) {
    return {
      success: false,
      error: "Code graph unavailable",
      message,
      data: result,
    };
  }
  return {
    success: true,
    message,
    data: result,
  };
}

const definitions: ToolDefinition[] = [
  {
    name: "search_specs_and_plans",
    description: "Search design specs (docs/superpowers/specs) and implementation plans (docs/superpowers/plans) by title and body, with optional itemId/epicId narrowing. Returns paths, titles, dates, snippets, and the backlog and epic references found in each match. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text query (case-insensitive substring match on title and body)" },
        kind: { type: "string", enum: ["spec", "plan"], description: "Restrict to one tree" },
        matches: { type: "number", description: "Max results (default 10, max 25)" },
        itemId: { type: "string", description: "Also include files that mention this backlog item id" },
        epicId: { type: "string", description: "Also include files that mention this epic id" },
      },
      required: ["query"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "get_code_graph_freshness",
    description: "Get the current freshness and confidence status of the committed source-code graph used for Build Studio impact analysis.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["plan", "review", "ship"],
  },
  {
    name: "search_code_graph",
    description: "Search the committed source-code graph for files, exported symbols, routes, tools, Prisma models, prompt sources, tests, and external modules.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name or path text to search for in the code graph." },
        limit: { type: "number", description: "Maximum number of results to return. Defaults to 10; maximum 50." },
        graphKey: { type: "string", description: "Optional graph key. Defaults to the platform source graph." },
      },
      required: ["query"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
  {
    name: "trace_code_surface",
    description: "Trace one route, MCP tool, or Prisma model to its graph-backed implementation files and related tests. Pass exactly one of route, tool, or model.",
    inputSchema: {
      type: "object",
      properties: {
        route: { type: "string", description: "Next.js route to trace, for example /build." },
        tool: { type: "string", description: "MCP tool name to trace, for example create_backlog_item." },
        model: { type: "string", description: "Prisma model name to trace, for example BacklogItem." },
        graphKey: { type: "string", description: "Optional graph key. Defaults to the platform source graph." },
      },
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
  {
    name: "find_related_tests",
    description: "Find graph-linked tests for a source file path.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Repository-relative source file path." },
        limit: { type: "number", description: "Maximum number of tests to return. Defaults to 25; maximum 50." },
        graphKey: { type: "string", description: "Optional graph key. Defaults to the platform source graph." },
      },
      required: ["filePath"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["build", "review", "ship"],
  },
  {
    name: "analyze_reusability",
    description: "Analyze a feature for reusability potential. Identifies hardcoded domain concepts that could be parameterized and rates contribution readiness. Call after codebase research, before saving the design doc.",
    inputSchema: {
      type: "object",
      properties: {
        featureDescription: { type: "string", description: "What the feature does." },
        domainConcepts: { type: "array", items: { type: "string" }, description: "Key domain concepts mentioned (e.g. 'ITIL', 'ABC Plumbing', 'quarterly')." },
        userScope: { type: "string", enum: ["one_off", "parameterizable", "already_generic"], description: "User's stated intent for reusability." },
        abstractionBoundary: { type: "string", description: "What is generic structure vs. instance-specific config." },
      },
      required: ["featureDescription", "domainConcepts", "userScope"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate"],
  },
];

async function searchSpecsAndPlansHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { searchSpecsAndPlans } = await import("@/lib/backlog/spec-plan-search");
  const query = String(params["query"] ?? "").trim();
  if (!query && !params["itemId"] && !params["epicId"])
    return {
      success: false,
      error: "missing_query",
      message: "query is required (or itemId/epicId)",
    };
  const kind = params["kind"] === "spec" || params["kind"] === "plan" ? params["kind"] : undefined;
  const matches = typeof params["matches"] === "number" ? params["matches"] : undefined;
  const itemId = typeof params["itemId"] === "string" ? params["itemId"] : undefined;
  const epicId = typeof params["epicId"] === "string" ? params["epicId"] : undefined;
  const results = await searchSpecsAndPlans({ query, kind, matches, itemId, epicId });
  return {
    success: true,
    message: `Found ${results.length} match(es).`,
    data: { results },
  };
}

async function getCodeGraphFreshnessHandler(): Promise<ToolResult> {
  const { getCodeGraphFreshness } = await import("@/lib/build/code-graph-access");
  const { buildTrustMessage } = await import("@/lib/trust-vector");
  const freshness = await getCodeGraphFreshness(undefined, { inspectStructuralHealth: true });
  return {
    success: true,
    message: freshness.trust
      ? buildTrustMessage(freshness.trust, {
          currentFact: freshness.summary,
          lastKnownFact: freshness.summary,
          lowConfidenceResult: freshness.summary,
          inferredResult: freshness.summary,
        })
      : freshness.summary,
    data: freshness,
  };
}

async function searchCodeGraphHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { searchCodeGraph } = await import("@/lib/build/code-graph/graph-queries");
  const result = await searchCodeGraph({
    query: String(params["query"] ?? ""),
    graphKey: optionalString(params["graphKey"]) ?? undefined,
    limit: typeof params["limit"] === "number" ? params["limit"] : undefined,
  });
  return codeGraphReadToolResult(result as unknown as Record<string, unknown> & {
    available?: unknown;
    summary?: unknown;
  });
}

async function traceCodeSurfaceHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { traceCodeSurface } = await import("@/lib/build/code-graph/graph-queries");
  const result = await traceCodeSurface({
    route: optionalString(params["route"]) ?? undefined,
    tool: optionalString(params["tool"]) ?? undefined,
    model: optionalString(params["model"]) ?? undefined,
    graphKey: optionalString(params["graphKey"]) ?? undefined,
  });
  return codeGraphReadToolResult(result as unknown as Record<string, unknown> & {
    available?: unknown;
    summary?: unknown;
  });
}

async function findRelatedTestsHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { findRelatedTests } = await import("@/lib/build/code-graph/graph-queries");
  const result = await findRelatedTests({
    filePath: String(params["filePath"] ?? ""),
    graphKey: optionalString(params["graphKey"]) ?? undefined,
    limit: typeof params["limit"] === "number" ? params["limit"] : undefined,
  });
  return codeGraphReadToolResult(result as unknown as Record<string, unknown> & {
    available?: unknown;
    summary?: unknown;
  });
}

async function analyzeReusabilityHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const featureDescription = String(params["featureDescription"] ?? "");
  const domainConcepts = Array.isArray(params["domainConcepts"]) ? (params["domainConcepts"] as string[]).map(String) : [];
  const userScope = String(params["userScope"] ?? "one_off") as "one_off" | "parameterizable" | "already_generic";
  const abstractionBoundary = String(params["abstractionBoundary"] ?? "");

  // Heuristic: proper nouns, acronyms, and specific vendor/standard names suggest parameterizable instances
  const properNounPattern = /^[A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*)*$/;
  const acronymPattern = /^[A-Z]{2,}$/;

  const domainEntities: Array<{ hardcodedValue: string; parameterName: string; otherInstances: string[] }> = [];

  for (const concept of domainConcepts) {
    const trimmed = concept.trim();
    if (!trimmed) continue;

    const isProperNoun = properNounPattern.test(trimmed);
    const isAcronym = acronymPattern.test(trimmed);

    if (isProperNoun || isAcronym) {
      // Suggest a parameter name by converting to camelCase category
      const parameterName = trimmed.length <= 5
        ? trimmed.toLowerCase() + "Type"
        : trimmed.replace(/\s+/g, "").charAt(0).toLowerCase() + trimmed.replace(/\s+/g, "").slice(1) + "Type";

      domainEntities.push({
        hardcodedValue: trimmed,
        parameterName,
        otherInstances: [], // Agent fills these from user conversation
      });
    }
  }

  // Score contribution readiness based on scope and entity count
  let contributionReadiness: "high" | "medium" | "low";
  if (userScope === "already_generic") {
    contributionReadiness = "high";
  } else if (userScope === "parameterizable") {
    contributionReadiness = domainEntities.length > 0 ? "medium" : "high";
  } else {
    contributionReadiness = "low";
  }

  // Surface canonical first-party palettes the agent should COMPOSE instead
  // of hand-rolling (e.g. report-kit for reporting/data-display UX). Sourced
  // from the in-code registry; each carries its governing kernel principle.
  const { matchCanonicalPrimitives } = await import("@/lib/canonical-primitives");
  const reusablePrimitives = matchCanonicalPrimitives(
    `${featureDescription} ${domainConcepts.join(" ")} ${abstractionBoundary}`,
  ).map((p) => ({
    name: p.name,
    path: p.path,
    purpose: p.purpose,
    exports: p.exports,
    principle: p.principleSlug,
    docs: p.docs,
  }));

  const analysis = {
    scope: userScope,
    domainEntities,
    abstractionBoundary: abstractionBoundary || (userScope === "one_off"
      ? "Feature is designed for a single use case."
      : "Domain-specific values should be stored as configuration rather than hardcoded."),
    contributionReadiness,
    reusablePrimitives,
  };

  const primitiveHint = reusablePrimitives.length
    ? ` Compose the existing palette instead of hand-rolling: ${reusablePrimitives
        .map((p) => `${p.name} (${p.exports.slice(0, 3).join(", ")}…; principle ${p.principle})`)
        .join("; ")}.`
    : "";

  return {
    success: true,
    message: `Reusability: ${userScope} — ${domainEntities.length} parameterizable concept(s), contribution readiness: ${contributionReadiness}.${primitiveHint}`,
    data: analysis as unknown as Record<string, unknown>,
  };
}

const handlers: Record<string, ToolPackHandler> = {
  search_specs_and_plans: (params) => searchSpecsAndPlansHandler(params),
  get_code_graph_freshness: () => getCodeGraphFreshnessHandler(),
  search_code_graph: (params) => searchCodeGraphHandler(params),
  trace_code_surface: (params) => traceCodeSurfaceHandler(params),
  find_related_tests: (params) => findRelatedTestsHandler(params),
  analyze_reusability: (params) => analyzeReusabilityHandler(params),
};

export const codeIntelligencePack: ToolPack = {
  packId: "code-intelligence",
  definitions,
  handlers,
  grants: {
    search_specs_and_plans: ["spec_plan_read", "backlog_read"],
    get_code_graph_freshness: ["code_graph_read"],
    search_code_graph: ["code_graph_read"],
    trace_code_surface: ["code_graph_read"],
    find_related_tests: ["code_graph_read"],
    analyze_reusability: ["backlog_read"],
  },
};
