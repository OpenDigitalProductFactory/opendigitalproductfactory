// apps/web/lib/build/plan-traceability-regeneration.ts
//
// BI-6F2872FC — a plan generated before tasks named their acceptance criteria
// can never be covered: the coverage writer traces each baseline acceptance id
// to a task's `satisfies`, and those plans carry none. On the live install that
// is every plan-phase build (746 of 746 tasks, 2026-10-21).
//
// Such a build is regenerated once, through the existing plan dispatch and its
// review, and only when a new plan can actually move it: the newest readiness
// decision for its plan -> build entry refuses it on the plan lanes and on
// nothing else. A build still owed a design review keeps its plan — a new plan
// cannot clear a design gate, and regenerating would spend inference for no
// change. Once per build: a plan that still names nothing after regeneration
// is reported by the coverage writer, not regenerated forever.

export const PLAN_TRACEABILITY_REGENERATION_TOOL = "plan-coverage:regenerated";

const PLAN_LANE_CODES = new Set(["PLAN_REQUIRED", "PLAN_REVIEW_REQUIRED", "PLAN_COVERAGE_REQUIRED", "TRACEABILITY_INCOMPLETE"]);
/** The lanes a regenerated, traced plan clears by itself. Plan review follows it. */
const COVERAGE_LANE_CODES = ["PLAN_REQUIRED", "PLAN_COVERAGE_REQUIRED", "TRACEABILITY_INCOMPLETE"];

export type PlanTraceabilityRegenerationDb = {
  backlogItemActivity: { findFirst(args: unknown): Promise<{ payload: unknown } | null> };
  buildActivity: { findFirst(args: unknown): Promise<{ id: string } | null> };
};

export type PlanTraceabilityRegenerationDecision =
  | { due: true }
  | { due: false; reason: "no-backlog-subject" | "plan-already-traced" | "plan-lanes-not-owed" | "other-gates-owed" | "already-regenerated" };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** True when some task of the plan names an acceptance id it satisfies. */
export function planNamesAcceptance(plan: unknown): boolean {
  const tasks = record(plan)?.tasks;
  return Array.isArray(tasks) && tasks.some((task) => {
    const refs = record(task)?.satisfies;
    return Array.isArray(refs) && refs.some((ref) => typeof ref === "string" && ref.trim().length > 0);
  });
}

async function defaultDb(): Promise<PlanTraceabilityRegenerationDb> {
  const { prisma } = await import("@dpf/db");
  return prisma as unknown as PlanTraceabilityRegenerationDb;
}

export async function decidePlanTraceabilityRegeneration(args: {
  buildId: string;
  originatorRowId: string | null;
  buildPlan: unknown;
  db?: PlanTraceabilityRegenerationDb;
}): Promise<PlanTraceabilityRegenerationDecision> {
  if (!args.originatorRowId) return { due: false, reason: "no-backlog-subject" };
  if (planNamesAcceptance(args.buildPlan)) return { due: false, reason: "plan-already-traced" };
  const db = args.db ?? await defaultDb();
  const latest = await db.backlogItemActivity.findFirst({
    where: {
      backlogItemId: args.originatorRowId,
      kind: "initiative_readiness_decision",
      payload: { path: ["transitionObject", "id"], equals: args.buildId },
    },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    select: { payload: true },
  });
  const codes = record(latest?.payload)?.stableCodes;
  const owed = Array.isArray(codes) ? codes.filter((code): code is string => typeof code === "string") : [];
  if (!COVERAGE_LANE_CODES.some((code) => owed.includes(code))) return { due: false, reason: "plan-lanes-not-owed" };
  if (owed.some((code) => !PLAN_LANE_CODES.has(code))) return { due: false, reason: "other-gates-owed" };
  const before = await db.buildActivity.findFirst({
    where: { buildId: args.buildId, tool: PLAN_TRACEABILITY_REGENERATION_TOOL },
    select: { id: true },
  });
  if (before) return { due: false, reason: "already-regenerated" };
  return { due: true };
}
