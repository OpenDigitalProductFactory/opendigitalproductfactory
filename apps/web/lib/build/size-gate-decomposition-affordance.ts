// apps/web/lib/build/size-gate-decomposition-affordance.ts
//
// BI-04B112CA / BI-97F7F599 — when the design-size gate says a design is too
// large for one build, decomposition is the owner's next action.
//
// The decomposition affordance already existed, but only for the SECONDARY
// entry point: a top-level `plan` build whose plan review is oscillating
// (see plan-oscillation-decomposition.ts). The PRIMARY entry point — the one
// the size gate itself creates — had no affordance at all, so an `ideate`
// build with a passed design and `decompose-required` fell through to
// "Advance to Plan", which the gate then refused.
//
// `propose_build_decomposition` and `approve_decomposition` have always
// accepted this case; DecompositionCoordinator has always rendered the size
// banner from `assessment`. Only the workflow-action resolver was missing it,
// so the panel never mounted and the owner was handed a blocked button.
//
// Live repro FB-41EA43C5 on the Pet Rescue install: design passed review,
// `decompose-required` (xlarge, 7 models, 24 ACs), and the only offered action
// was "Advance to Plan" — which threw rather than explaining itself.
//
// Pure module — no Prisma, no React — so the rule is testable on its own.

import type { BuildDesignDoc, BuildPhase, ReviewResult } from "@/lib/feature-build-types";

/** The size decisions that call for splitting the build. */
const DECOMPOSING_DECISIONS = new Set(["decompose-required", "decompose-recommended"]);

export type SizeGateDecompositionAffordance =
  | { kind: "none" }
  | {
      kind: "decompose-now";
      /** Which side of the gate fired — `required` blocks, `recommended` advises. */
      required: boolean;
      disabledReason: string | null;
    };

export type SizeGateBuildInput = {
  phase: BuildPhase;
  designReview: ReviewResult | null;
  designDoc: BuildDesignDoc | null;
};

function sizeDecisionOf(designReview: ReviewResult | null): string | null {
  const assessment = (designReview as { sizeAssessment?: { decision?: unknown } } | null)
    ?.sizeAssessment;
  const decision = assessment?.decision;
  return typeof decision === "string" ? decision : null;
}

/**
 * Decide whether an ideate build should be offered decomposition.
 *
 * Deliberately narrow: only a build whose design has PASSED review can be
 * split, because the child scopes are derived from that design's acceptance
 * criteria. A failing design is the design loop's problem, not the size gate's.
 */
export function deriveSizeGateDecompositionAffordance(
  build: SizeGateBuildInput,
): SizeGateDecompositionAffordance {
  if (build.phase !== "ideate") return { kind: "none" };
  if (build.designReview?.decision !== "pass") return { kind: "none" };

  const decision = sizeDecisionOf(build.designReview);
  if (decision === null || !DECOMPOSING_DECISIONS.has(decision)) return { kind: "none" };

  return {
    kind: "decompose-now",
    required: decision === "decompose-required",
    // The child scopes are cut from the parent's acceptance criteria, so the
    // design document has to be there to split at all.
    disabledReason: build.designDoc ? null : "Need a design doc first.",
  };
}

/**
 * The owner-facing action for a design the size gate wants split.
 *
 * The copy lives here, beside the rule that decides it, rather than inline in
 * the workflow-action resolver: Build Studio's component surface is under a
 * ratchet (BI-101C107C) and this is decision text, not presentation.
 *
 * Returns null when the gate has nothing to say, so the caller can fall through
 * to its normal next action.
 */
export function sizeGateDecompositionAction(build: SizeGateBuildInput): {
  title: string;
  message: string;
  primaryLabel: string;
  disabledReason: string | null;
  coworkerLabel: string;
  coworkerPrompt: string;
} | null {
  const affordance = deriveSizeGateDecompositionAffordance(build);
  if (affordance.kind !== "decompose-now") return null;

  return {
    title: affordance.required
      ? "This Design Is Too Big For One Build"
      : "This Design Would Be Easier In Parts",
    message: affordance.required
      ? "The design passed review, but it covers more than one build can carry. Split it into smaller builds that each finish on their own, then plan those."
      : "The design passed review. It is large enough that splitting it into smaller builds would likely land sooner, though you can plan it as one.",
    primaryLabel: "Split into smaller builds",
    disabledReason: affordance.disabledReason,
    coworkerLabel: "Talk through the split",
    coworkerPrompt:
      "The design review passed but the size gate says this build is too large. Walk me through what it covers, then propose how to split it into smaller builds that each deliver something on their own.",
  };
}
