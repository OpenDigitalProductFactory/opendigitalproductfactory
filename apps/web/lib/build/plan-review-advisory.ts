// apps/web/lib/build/plan-review-advisory.ts
//
// BI-A87DE5E1: two rules the advisory plan-review path was missing. On the dev
// install (FB-F88BFE10) a one-task "regenerate the plan" meta-plan with no files
// failed review, the review was ADVISORY for a small fix, and the build advanced
// and coded against it. The revision loop then wrote a good plan over buildPlan
// while the orchestrator was already running the rejected one.

type PlanLike = { fileStructure?: unknown } | null | undefined;

/** A plan that names no file to touch is not a plan, whatever the gate says. */
export function planNamesNoFiles(plan: unknown): boolean {
  const files = (plan as PlanLike)?.fileStructure;
  if (!Array.isArray(files)) return true;
  return !files.some((entry) => {
    const path = entry && typeof entry === "object" ? (entry as { path?: unknown }).path : null;
    return typeof path === "string" && path.trim().length > 0;
  });
}

/** Revise a rejected plan only while the build is still in plan. */
export function shouldReviseRejectedPlan<T extends { decision?: string }>(
  review: T | null | undefined,
  phase: string | null | undefined,
): review is T {
  return review?.decision === "fail" && phase === "plan";
}
