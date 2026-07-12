// Build-visibility tool pack — EP-8DC217EB BET-4.
//
// Drains the read-only Build Studio observability tools out of the
// mcp-tools.ts executeTool switch: the five tools an observer uses to inspect
// a build's progress projection, codex-dispatch history, scoped verification,
// recent activity, and code-graph impact of the current diff. Each handler is
// the former switch case verbatim, so behaviour is identical when a tool is
// invoked over MCP. Build id is auto-resolved through the shared build helpers.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import { prisma } from "@dpf/db";

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import { extractBuildIdHint, resolveActiveBuildId } from "@/lib/mcp/build-tool-helpers";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "get_build_dispatch_history",
    description: "Read bounded codex-dispatch attempts for a Build Studio build, including model, duration, exit code, sanitized stdout/stderr excerpts, and classified failure axis.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "get_build_progress_visibility",
    description: "Read the Build Studio progress projection for a build: source-labelled DB task progress, stale chat conflicts, sandbox state, dispatch history, scoped verification, and quiet-agent status.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "get_build_scoped_verification",
    description: "Read build-scoped verification for a Build Studio build, separating failures on the build's changed surface from workspace-wide/global-health noise.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "list_build_activity_since",
    description: "List recent BuildActivity rows for a Build Studio build after an optional ISO timestamp cursor. Use this for polling-friendly observer updates.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "Optional FB-* build ID. Omit to target the current active build." },
        cursor: { type: "string", description: "Optional ISO timestamp cursor; only rows after this timestamp are returned." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "inspect_build_code_impact",
    description: "Analyze the active build's current diff and return route/schema impact plus code-graph coverage. Build ID is auto-resolved.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["review", "ship"],
  },
];

const getBuildDispatchHistory: ToolPackHandler = async (params, userId) => {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
  const { getDispatchHistoryForBuild } = await import("@/lib/build/dispatch-attempts");
  const history = await getDispatchHistoryForBuild(buildId);
  return {
    success: true,
    entityId: buildId,
    message: `Dispatch history loaded for ${buildId}: ${history.length} attempt(s).`,
    data: { buildId, attempts: history },
  };
};

const getBuildProgressVisibilityHandler: ToolPackHandler = async (params, userId) => {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
  const { getBuildProgressVisibility } = await import("@/lib/build/progress-visibility");
  const projection = await getBuildProgressVisibility(buildId);
  if (!projection) return { success: false, error: "Build not found", message: `Build ${buildId} was not found.` };
  return {
    success: true,
    entityId: buildId,
    message: `Build progress visibility loaded for ${buildId}: ${projection.progress.primary.completed}/${projection.progress.primary.total} tasks from ${projection.progress.primary.source}.`,
    data: projection as unknown as Record<string, unknown>,
  };
};

const getBuildScopedVerification: ToolPackHandler = async (params, userId) => {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
  const { getScopedVerificationForBuild } = await import("@/lib/build/scoped-verification");
  const verification = await getScopedVerificationForBuild(buildId);
  if (!verification) return { success: false, error: "Build not found", message: `Build ${buildId} was not found.` };
  return {
    success: true,
    entityId: buildId,
    message: `Scoped verification loaded for ${buildId}: ${verification.buildScoped.failureAxis ?? "no failure"} axis.`,
    data: verification as unknown as Record<string, unknown>,
  };
};

const listBuildActivitySince: ToolPackHandler = async (params, userId) => {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
  const cursor = typeof params["cursor"] === "string" && params["cursor"].trim()
    ? new Date(params["cursor"])
    : null;
  if (cursor != null && !Number.isFinite(cursor.getTime())) {
    return { success: false, error: "Invalid cursor", message: "cursor must be an ISO timestamp when provided." };
  }
  const activities = await prisma.buildActivity.findMany({
    where: {
      buildId,
      ...(cursor ? { createdAt: { gt: cursor } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true, buildId: true, tool: true, summary: true, createdAt: true },
  });
  const rows = activities.map((activity) => ({
    ...activity,
    createdAt: activity.createdAt.toISOString(),
  }));
  return {
    success: true,
    entityId: buildId,
    message: `Loaded ${rows.length} build activit${rows.length === 1 ? "y" : "ies"} for ${buildId}.`,
    data: {
      buildId,
      activities: rows,
      nextCursor: rows.at(-1)?.createdAt ?? params["cursor"] ?? null,
    },
  };
};

const inspectBuildCodeImpact: ToolPackHandler = async (params, userId) => {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) {
    return { success: false, error: "No active build.", message: "No active build." };
  }

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { buildId: true, title: true, diffPatch: true },
  });
  if (!build?.diffPatch) {
    return {
      success: false,
      error: "No diff patch saved yet.",
      message: "No build diff is available yet. Run the build and save a diff before inspecting code impact.",
    };
  }

  const { analyzeChangeImpact, formatImpactForChat } = await import("@/lib/change-impact");
  const report = await analyzeChangeImpact(build.diffPatch);
  return {
    success: true,
    message: `Impact analysis for ${build.title ?? build.buildId}:\n\n${formatImpactForChat(report)}`,
    data: {
      buildId: build.buildId,
      report,
    },
  };
};

const handlers: Record<string, ToolPackHandler> = {
  get_build_dispatch_history: getBuildDispatchHistory,
  get_build_progress_visibility: getBuildProgressVisibilityHandler,
  get_build_scoped_verification: getBuildScopedVerification,
  list_build_activity_since: listBuildActivitySince,
  inspect_build_code_impact: inspectBuildCodeImpact,
};

export const buildVisibilityPack: ToolPack = {
  packId: "build-visibility",
  definitions,
  handlers,
  grants: {
    get_build_dispatch_history: ["work_capsule_read"],
    get_build_progress_visibility: ["work_capsule_read"],
    get_build_scoped_verification: ["work_capsule_read"],
    list_build_activity_since: ["work_capsule_read"],
    inspect_build_code_impact: ["code_graph_read"],
  },
};
