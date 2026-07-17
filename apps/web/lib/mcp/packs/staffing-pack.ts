// Workforce staffing tool pack — EP-WORKFORCE-OPS / BI-4AD09A35 Phase 5.
//
// The read surface the coordinator/coworker uses over MCP to see staffing
// demand and coverage against the canonical staffing substrate (Phase 1). These
// are minimum-necessary reads on the `registry_read` coworker baseline; the
// write tools (declare availability, prepare/publish proposal) are deny-by-
// default follow-ups that carry their own scoped grants and route through the
// human-authority boundary (Phase 4). Definitions + grants live together here;
// grants mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source
// (tool-registry.test.ts asserts they never drift).
//
// Handlers lazy-import Prisma so the pack stays a thin, tree-shakeable module.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const definitions: ToolDefinition[] = [
  {
    name: "list_staffing_demand",
    description:
      "List staffing demand (required coverage) for an organization: interval, role/skills, quantity, and status. Read-only. Use to see what coverage is required before preparing a proposal.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string", description: "Organization id to scope to" },
        status: {
          type: "string",
          enum: ["open", "partially_covered", "covered", "cancelled"],
          description: "Filter by demand status (optional)",
        },
        limit: { type: "number", description: "Max results (default 50)" },
      },
      required: ["organizationId"],
    },
    requiredCapability: "view_employee",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "get_staffing_coverage",
    description:
      "Summarize coverage for an organization's staffing demand: for each demand, the required vs currently-assigned quantity and whether it is fully covered. Read-only, minimum-necessary — returns counts, not private employee detail.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string", description: "Organization id to scope to" },
      },
      required: ["organizationId"],
    },
    requiredCapability: "view_employee",
    executionMode: "immediate",
    sideEffect: false,
  },
];

async function listStaffingDemand(params: Record<string, unknown>): Promise<ToolResult> {
  const organizationId = String(params["organizationId"] ?? "");
  if (!organizationId) {
    return { success: false, error: "organizationId is required", message: "Provide an organizationId" };
  }
  const status = params["status"] ? String(params["status"]) : undefined;
  const limit = typeof params["limit"] === "number" ? (params["limit"] as number) : 50;
  const { prisma } = await import("@dpf/db");
  const rows = await prisma.staffingDemand.findMany({
    where: { organizationId, ...(status ? { status } : {}) },
    orderBy: [{ startAt: "asc" }],
    take: limit,
    select: {
      demandId: true,
      demandShape: true,
      startAt: true,
      endAt: true,
      timezone: true,
      roleKey: true,
      requiredSkills: true,
      minQuantity: true,
      targetQuantity: true,
      status: true,
      priority: true,
    },
  });
  return {
    success: true,
    message: `Found ${rows.length} staffing demand record(s).`,
    data: { demand: rows },
  };
}

async function getStaffingCoverage(params: Record<string, unknown>): Promise<ToolResult> {
  const organizationId = String(params["organizationId"] ?? "");
  if (!organizationId) {
    return { success: false, error: "organizationId is required", message: "Provide an organizationId" };
  }
  const { prisma } = await import("@dpf/db");
  const demands = await prisma.staffingDemand.findMany({
    where: { organizationId, status: { not: "cancelled" } },
    select: {
      demandId: true,
      minQuantity: true,
      targetQuantity: true,
      status: true,
      shifts: {
        select: {
          requiredQuantity: true,
          assignments: {
            where: { lifecycle: { in: ["confirmed", "completed"] } },
            select: { id: true },
          },
        },
      },
    },
  });
  const coverage = demands.map((d) => {
    const assigned = d.shifts.reduce((sum, s) => sum + s.assignments.length, 0);
    const required = d.targetQuantity ?? d.minQuantity;
    return {
      demandId: d.demandId,
      required,
      assigned,
      covered: assigned >= required,
      status: d.status,
    };
  });
  const uncovered = coverage.filter((c) => !c.covered).length;
  return {
    success: true,
    message: `${coverage.length} demand record(s); ${uncovered} not yet fully covered.`,
    data: { coverage, uncoveredCount: uncovered },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  list_staffing_demand: (params) => listStaffingDemand(params),
  get_staffing_coverage: (params) => getStaffingCoverage(params),
};

export const staffingPack: ToolPack = {
  packId: "staffing",
  definitions,
  handlers,
  grants: {
    list_staffing_demand: ["registry_read"],
    get_staffing_coverage: ["registry_read"],
  },
};
