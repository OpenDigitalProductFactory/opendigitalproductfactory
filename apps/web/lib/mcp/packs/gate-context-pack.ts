// Gate-context tool pack (BI-121DC3A3, parent BI-2677A465).
//
// Exposes the gate-context pack generator over MCP so in-portal coworkers and
// Build Studio agents can ask, before writing code, which CI constraints
// apply to the files they intend to touch. The handler shells to
// scripts/gate-context.mjs via the gate-context-bridge — the generator stays
// the single source; this pack never restates a rule. Read-only, advisory:
// it never claims a gate passed.
//
// Grants mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "get_change_gate_context",
    description: "Return the CI gate constraints for planned or changed files, derived from the live gate registries.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          description: "Files; defaults to the active build plan.",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Repo-relative path." },
              status: { type: "string", enum: ["A", "M", "D"], description: "A=new, M=modified, D=deleted." },
            },
            required: ["path"],
          },
        },
        buildId: { type: "string", description: "Optional FB-* build id." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
  },
];

async function getChangeGateContext(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const { plannedChangesFromPlan, computeGateContextMarkdown } = await import(
    "@/lib/integrate/gate-context-bridge"
  );

  let changedFiles = Array.isArray(params.paths)
    ? (params.paths as Array<{ path?: unknown; status?: unknown }>)
        .map((entry) => ({
          path: typeof entry?.path === "string" ? entry.path : "",
          status: (entry?.status === "A" || entry?.status === "D" ? entry.status : "M") as "A" | "M" | "D",
        }))
        .filter((entry) => entry.path.length > 0)
    : [];

  if (changedFiles.length === 0) {
    const { resolveActiveBuildId, extractBuildIdHint } = await import("@/lib/mcp/build-tool-helpers");
    const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
    if (!buildId) {
      return {
        success: false,
        error: "No paths and no active build.",
        message: "Pass paths[] or run inside an active build whose plan lists fileStructure targets.",
      };
    }
    const { prisma } = await import("@dpf/db");
    const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { plan: true } });
    changedFiles = plannedChangesFromPlan((build?.plan ?? null) as Record<string, unknown> | null);
    if (changedFiles.length === 0) {
      return {
        success: false,
        error: "No planned files.",
        message: `Build ${buildId} has no plan fileStructure entries yet; pass paths[] explicitly.`,
      };
    }
  }

  const [markdown, packJson] = await Promise.all([
    computeGateContextMarkdown(changedFiles),
    computeGateContextMarkdown(changedFiles, { json: true }),
  ]);
  if (!markdown) {
    return {
      success: false,
      error: "Generator unavailable.",
      message: "The gate-context generator (scripts/gate-context.mjs) is not reachable from this runtime; run `pnpm gate:context` in the worktree instead.",
    };
  }

  let pack: Record<string, unknown> | null = null;
  try {
    pack = packJson ? (JSON.parse(packJson) as Record<string, unknown>) : null;
  } catch { /* markdown remains the payload */ }

  return {
    success: true,
    message: markdown,
    data: { changedFileCount: changedFiles.length, pack },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  get_change_gate_context: (params, userId) => getChangeGateContext(params, userId),
};

export const gateContextPack: ToolPack = {
  packId: "gate-context",
  definitions,
  handlers,
  grants: {
    get_change_gate_context: ["code_graph_read"],
  },
};
