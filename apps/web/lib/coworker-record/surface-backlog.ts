// Coworker "My Surface Backlog" slice — BI-012C0B58.
//
// Server-only. The identity-scoped backlog slice for ONE coworker, shared by
// the `list_my_backlog` MCP tool and the coworker-record "Backlog" panel so
// both read from one query and can never drift. Scope is resolved from the
// coworker's identity via resolveCoworkerBacklogScope (portfolio/surface ∪
// occupation-capabilities ∪ owned/claimed); there is no widening input — the
// only params are status/workType/limit narrowers.

import { resolveCoworkerBacklogScope } from "@/lib/mcp/packs/coworker-scope";
import { backlogScopeSelect, scopeData } from "@/lib/mcp/packs/backlog-scope-metadata";

export interface SurfaceBacklogItem {
  itemId: string;
  title: string;
  status: string;
  type: string;
  workType: string | null;
  priority: number | null;
  effortSize: string | null;
  triageOutcome: string | null;
  epicId: string | null;
  updatedAt: string;
  scopeKind: string | null;
  archetypeCategories: string[];
  archetypeIds: string[];
  scopeRationale?: string | null;
  lifecycleTags: string[];
}

export interface CoworkerBacklogSlice {
  scope: {
    portfolioId: string | null;
    valueStream: string | null;
    professionKey: string | null;
    /** False when the occupation arm did not apply (slice is area + owned only). */
    occupationArmApplied: boolean;
  };
  summary: { open: number; inProgress: number; done: number };
  total: number;
  truncated: boolean;
  items: SurfaceBacklogItem[];
}

const STATUS_VALUES = new Set(["triaging", "open", "in-progress", "done", "deferred", "retired"]);
const WORK_TYPE_VALUES = new Set(["bug", "feature", "chore", "doc", "tool", "skill", "refactor"]);

function clampLimit(raw?: number): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 50;
  return Math.max(1, Math.min(200, n));
}

export async function getCoworkerBacklogSlice(
  agentId: string,
  opts: { status?: string; workType?: string; limit?: number; routeContext?: string | null } = {},
): Promise<CoworkerBacklogSlice> {
  const { prisma } = await import("@dpf/db");
  const scope = await resolveCoworkerBacklogScope(agentId, opts.routeContext ?? null);

  const scopeWhere = { OR: scope.orClauses };
  const filters: Record<string, unknown> = { ...scopeWhere };
  if (opts.status && STATUS_VALUES.has(opts.status)) filters["status"] = opts.status;
  if (opts.workType && WORK_TYPE_VALUES.has(opts.workType)) filters["workType"] = opts.workType;

  const limit = clampLimit(opts.limit);

  const [items, total, open, inProgress, done] = await Promise.all([
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
        triageOutcome: true,
        updatedAt: true,
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
    scope: {
      portfolioId: scope.portfolioId,
      valueStream: scope.valueStream,
      professionKey: scope.professionKey,
      occupationArmApplied: scope.occupationArmApplied,
    },
    summary: { open, inProgress, done },
    total,
    truncated: items.length < total,
    items: items.map((i) => ({
      itemId: i.itemId,
      title: i.title,
      status: i.status,
      type: i.type,
      workType: i.workType,
      priority: i.priority,
      effortSize: i.effortSize,
      triageOutcome: i.triageOutcome,
      epicId: i.epic?.epicId ?? null,
      updatedAt: i.updatedAt.toISOString(),
      ...scopeData(i),
    })),
  };
}
