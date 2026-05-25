import type {
  BuildDesignDoc,
  BuildPhase,
  ReviewResult,
} from "@/lib/feature-build-types";

export type PlanOscillationDecompositionAffordance =
  | { kind: "none" }
  | { kind: "decompose-now"; disabledReason: string | null }
  | { kind: "amend-parent-design"; disabledReason: string | null };

export type PlanOscillationBuildInput = {
  phase: BuildPhase;
  planReview: ReviewResult | null;
  parentEpicId?: string | null;
  designDoc: BuildDesignDoc | null;
};

export function isPlanReviewOscillating(
  planReview: ReviewResult | null | undefined,
): boolean {
  return planReview?.decision === "fail" && planReview.iteration?.oscillating === true;
}

export function derivePlanOscillationDecompositionAffordance(
  build: PlanOscillationBuildInput,
): PlanOscillationDecompositionAffordance {
  if (build.phase !== "plan" || !isPlanReviewOscillating(build.planReview)) {
    return { kind: "none" };
  }

  if (build.parentEpicId != null) {
    return { kind: "amend-parent-design", disabledReason: null };
  }

  return {
    kind: "decompose-now",
    disabledReason: build.designDoc ? null : "Need a design doc first.",
  };
}
