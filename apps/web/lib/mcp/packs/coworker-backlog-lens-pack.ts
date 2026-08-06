// Coworker backlog lens — BI-474A1F55.
//
// list_my_backlog: the acting coworker's own slice of the backlog, scoped by
// identity to its surface (portfolio / taxonomy area), occupation (business
// capabilities in its value stream) and owned/claimed work, with a status
// roll-up. There is NO scope argument — a coworker cannot widen past its own
// slice, which is what keeps the lens safe on a small local model and for
// sensitivity-restricted portfolios. Open (get_backlog_item) and file
// (create_backlog_item, which already stamps the caller's agentId) are reused
// unchanged; this pack adds only the missing read lens.

import { BACKLOG_STATUS_VALUES, BACKLOG_WORK_TYPE_VALUES } from "@/lib/explore/backlog";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";

import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { backlogScopeSelect, scopeData } from "./backlog-scope-metadata";
import { requireCurrentCoworker, resolveCoworkerBacklogScope } from "./coworker-scope";

function clampLimit(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 50;
  return Math.max(1, Math.min(200, n));
}

const definitions: ToolDefinition[] = [
  {
    name: "list_my_backlog",
    description:
      "List the backlog items for your own area — your portfolio/surface, your occupation's capabilities, and anything assigned to or claimed by you — with an open/in-progress/done roll-up. Scope is resolved from your identity; there is no argument to widen it to another area. Optionally narrow by status or workType.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: [...BACKLOG_STATUS_VALUES],
          description: "Only items in this status.",
        },
        workType: {
          type: "string",
          enum: [...BACKLOG_WORK_TYPE_VALUES],
          description: "Only items of this work type (e.g. tool, skill, feature) — useful for your own capability-evolution work.",
        },
        limit: { type: "number", description: "Max items to return (default 50, max 200)." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
];

async function listMyBacklogHandler(
  params: Record<string, unknown>,
  context: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  const agentId = requireCurrentCoworker(context);
  const scope = await resolveCoworkerBacklogScope(agentId, context?.routeContext ?? null);
  const { prisma } = await import("@dpf/db");

  const scopeWhere = { OR: scope.orClauses };
  const filters: Record<string, unknown> = { ...scopeWhere };
  if (typeof params["status"] === "string") filters["status"] = params["status"];
  if (typeof params["workType"] === "string") filters["workType"] = params["workType"];

  const limit = clampLimit(params["limit"]);

  const [items, matching, open, inProgress, done] = await Promise.all([
    prisma.backlogItem.findMany({
      where: filters,
      orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
      take: limit,
      select: {
        itemId: true,
        title: true,
        status: true,
        type: true,
        workType: true,
        priority: true,
        effortSize: true,
        updatedAt: true,
        triageOutcome: true,
        ...backlogScopeSelect,
        epic: { select: { epicId: true } },
      },
    }),
    prisma.backlogItem.count({ where: filters }),
    prisma.backlogItem.count({ where: { AND: [scopeWhere, { status: "open" }] } }),
    prisma.backlogItem.count({ where: { AND: [scopeWhere, { status: "in-progress" }] } }),
    prisma.backlogItem.count({ where: { AND: [scopeWhere, { status: "done" }] } }),
  ]);

  return {
    success: true,
    message: `Your backlog: ${open} open, ${inProgress} in-progress, ${done} done. Showing ${items.length} of ${matching} in-scope item(s).`,
    data: {
      scope: {
        portfolioId: scope.portfolioId,
        valueStream: scope.valueStream,
        professionKey: scope.professionKey,
        occupationArmApplied: scope.occupationArmApplied,
      },
      summary: { open, inProgress, done },
      total: matching,
      truncated: items.length < matching,
      items: items.map((i) => ({
        itemId: i.itemId,
        title: i.title,
        status: i.status,
        type: i.type,
        workType: i.workType,
        priority: i.priority,
        effortSize: i.effortSize,
        triageOutcome: i.triageOutcome,
        ...scopeData(i),
        epicId: i.epic?.epicId ?? null,
        updatedAt: i.updatedAt.toISOString(),
      })),
    },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  list_my_backlog: (params, _userId, context) => listMyBacklogHandler(params, context),
};

export const coworkerBacklogLensPack: ToolPack = {
  packId: "coworker-backlog-lens",
  definitions,
  handlers,
  grants: {
    list_my_backlog: ["backlog_read"],
  },
};
