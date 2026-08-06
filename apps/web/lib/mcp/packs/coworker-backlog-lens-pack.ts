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
import { getCoworkerBacklogSlice } from "@/lib/coworker-record/surface-backlog";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";

import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { requireCurrentCoworker } from "./coworker-scope";

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
  // The slice query is shared with the coworker-record "Backlog" panel
  // (lib/coworker-record/surface-backlog) so the tool and the UI never drift.
  const slice = await getCoworkerBacklogSlice(agentId, {
    status: typeof params["status"] === "string" ? params["status"] : undefined,
    workType: typeof params["workType"] === "string" ? params["workType"] : undefined,
    limit: typeof params["limit"] === "number" ? params["limit"] : undefined,
    routeContext: context?.routeContext ?? null,
  });

  return {
    success: true,
    message: `Your backlog: ${slice.summary.open} open, ${slice.summary.inProgress} in-progress, ${slice.summary.done} done. Showing ${slice.items.length} of ${slice.total} in-scope item(s).`,
    data: { ...slice },
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
