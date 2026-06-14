// apps/web/lib/build/review-lenses.ts
//
// Pure derivation: FeatureBuildRow → the review-gate "lenses" that have real,
// persisted evidence behind them. Drives the ReviewReadinessStrip shown in the
// Review-phase inspector.
//
// Every lens here maps to a field that is actually stored on the row — there is
// NO synthetic per-reviewer roster (the build review system merges its two
// reviewers into a single ReviewResult via mergeReviews(), so individual
// reviewer identity is not persisted). See the §6.2 note in
// docs/superpowers/specs/2026-06-13-agent-activity-strip-design.md.
//
// No DB imports, no side effects — fully unit-testable in the node environment.

import type { FeatureBuildRow, ReviewResult } from "@/lib/feature-build-types";

export type ReviewLensState = "pass" | "fail" | "advisory" | "partial" | "pending";

export type ReviewLens = {
  /** Stable key for React lists + test targeting. */
  key: string;
  /** Operator-facing lens name. */
  label: string;
  state: ReviewLensState;
  /** Short evidence summary, e.g. "2 critical · 1 important" or "12/12 clean". */
  detail: string;
};

/** Summarize a ReviewResult's issues by severity into a compact chip detail.
 *  Returns "" when there are no issues. */
function summarizeIssues(issues: ReviewResult["issues"]): string {
  const counts = { critical: 0, important: 0, minor: 0 };
  for (const issue of issues) counts[issue.severity]++;
  const parts: string[] = [];
  if (counts.critical) parts.push(`${counts.critical} critical`);
  if (counts.important) parts.push(`${counts.important} important`);
  if (counts.minor) parts.push(`${counts.minor} minor`);
  return parts.join(" · ");
}

/** Append a "round N" / oscillating suffix when the review iterated. */
function roundSuffix(review: ReviewResult): string {
  const round = review.iteration?.round;
  if (!round || round <= 1) return "";
  return review.iteration?.oscillating ? ` · round ${round} ↻` : ` · round ${round}`;
}

/** The merged checklist review (plan-phase preferred, design-phase fallback). */
function checklistLens(review: ReviewResult | null): ReviewLens {
  if (!review || review.parseError) {
    return {
      key: "checklist",
      label: "Checklist review",
      state: "pending",
      detail: review?.parseError ? "review unavailable" : "not yet reviewed",
    };
  }
  const issues = summarizeIssues(review.issues);
  if (review.decision === "fail") {
    return {
      key: "checklist",
      label: "Checklist review",
      state: "fail",
      detail: (issues || "blocking issues") + roundSuffix(review),
    };
  }
  return {
    key: "checklist",
    label: "Checklist review",
    state: "pass",
    detail: (issues ? `cleared · ${issues}` : "cleared") + roundSuffix(review),
  };
}

/** Advisory architecture lens — only present when the EA reviewer ran.
 *  Never gates; always renders as "advisory". */
function architectureLens(review: ReviewResult | null): ReviewLens | null {
  const advisory = review?.architectureAdvisory;
  if (!advisory) return null;
  const noteCount = advisory.issues.length;
  return {
    key: "architecture",
    label: "Architecture",
    state: "advisory",
    detail: noteCount === 0 ? "aligned" : `${noteCount} note${noteCount === 1 ? "" : "s"}`,
  };
}

/** Per-task code review rolled up from taskResults[].codeReview. */
function codeReviewLens(taskResults: FeatureBuildRow["taskResults"]): ReviewLens | null {
  if (!taskResults || taskResults.length === 0) return null;
  const total = taskResults.length;
  const flagged = taskResults.filter((t) => t.codeReview?.decision === "fail").length;
  if (flagged > 0) {
    return {
      key: "code-review",
      label: "Code review",
      state: "fail",
      detail: `${flagged}/${total} task${total === 1 ? "" : "s"} flagged`,
    };
  }
  return {
    key: "code-review",
    label: "Code review",
    state: "pass",
    detail: `${total}/${total} clean`,
  };
}

/** UX checks from the recorded uxTestResults. */
function uxLens(uxTestResults: FeatureBuildRow["uxTestResults"]): ReviewLens | null {
  if (!uxTestResults || uxTestResults.length === 0) return null;
  const total = uxTestResults.length;
  const passed = uxTestResults.filter((r) => r.passed).length;
  return {
    key: "ux",
    label: "UX checks",
    state: passed === total ? "pass" : "fail",
    detail: `${passed}/${total} passed`,
  };
}

/** Merged-code verification (typecheck + tests). */
function verificationLens(verificationOut: FeatureBuildRow["verificationOut"]): ReviewLens {
  if (!verificationOut) {
    return { key: "verification", label: "Verification", state: "pending", detail: "not run" };
  }
  const { typecheckPassed, testsFailed } = verificationOut;
  if (typecheckPassed && testsFailed === 0) {
    return { key: "verification", label: "Verification", state: "pass", detail: "typecheck ✓ · tests ✓" };
  }
  if (!typecheckPassed) {
    return { key: "verification", label: "Verification", state: "fail", detail: "typecheck ✗" };
  }
  return {
    key: "verification",
    label: "Verification",
    state: "fail",
    detail: `${testsFailed} test${testsFailed === 1 ? "" : "s"} failing`,
  };
}

/** Acceptance criteria met/total. */
function acceptanceLens(acceptanceMet: FeatureBuildRow["acceptanceMet"]): ReviewLens | null {
  if (!acceptanceMet || acceptanceMet.length === 0) return null;
  const total = acceptanceMet.length;
  const met = acceptanceMet.filter((c) => c.met).length;
  return {
    key: "acceptance",
    label: "Acceptance",
    state: met === total ? "pass" : "partial",
    detail: `${met}/${total} met`,
  };
}

/**
 * Derive the ordered set of review lenses for a build, in review-gate lineage
 * order. Optional lenses (architecture, code review, UX, acceptance) are omitted
 * entirely when their backing artifact is absent, so the strip never shows a
 * chip with no evidence behind it. The checklist + verification lenses always
 * render (with a "pending" state) because they are the spine of the gate.
 */
export function deriveReviewLenses(build: FeatureBuildRow): ReviewLens[] {
  const checklistReview = build.planReview ?? build.designReview ?? null;
  const lenses: Array<ReviewLens | null> = [
    checklistLens(checklistReview),
    architectureLens(checklistReview),
    codeReviewLens(build.taskResults),
    uxLens(build.uxTestResults),
    verificationLens(build.verificationOut),
    acceptanceLens(build.acceptanceMet),
  ];
  return lenses.filter((lens): lens is ReviewLens => lens !== null);
}
