// BI-6F2872FC — a Build Studio plan's platform-recorded coverage satisfies the
// large plan gates; a repository plan is not the only way in.
import { describe, expect, it } from "vitest";

import { buildPlanCoveragePayload, traceBuildPlanToAcceptance } from "./build-plan-coverage";
import { projectBacklogItemReadiness } from "./entry-adapter";
import { baseline, item, readyActivities, receipt, transitionObject } from "./entry-adapter.test-fixtures";

const PLAN_DIGEST = `sha256:${"c".repeat(64)}`;

function revisionCoverage() {
  const trace = traceBuildPlanToAcceptance({ tasks: [{ title: "t", satisfies: ["AC-1"] }] }, ["AC-1"]);
  if (!trace.complete) throw new Error("fixture");
  return {
    id: "coverage-revision",
    kind: "plan_backlog_coverage",
    gateKey: null,
    recordedAt: new Date("2026-08-23T00:00:00.000Z"),
    payload: buildPlanCoveragePayload({
      itemId: item.itemId,
      buildId: "FB-1",
      revisionId: "rev-plan",
      planDigest: PLAN_DIGEST,
      baseline: { baselineId: baseline.baselineId, artifactDigest: baseline.artifactDigest },
      acceptanceIds: ["AC-1"],
      trace,
      recordedAt: "2026-08-23T00:00:00.000Z",
    }),
  };
}

const planReviewOfPlan = (() => {
  const base = receipt("r-plan-review-revision", "plan-review");
  return { ...base, payload: { ...base.payload, artifactRef: { kind: "feature-build-revision", revisionId: "rev-plan" }, artifactDigest: PLAN_DIGEST } };
})();

function withoutRepositoryPlan(): Activities {
  return readyActivities().filter((entry) => entry.kind !== "plan_backlog_coverage" && entry.gateKey !== "plan-review");
}

type Activities = Parameters<typeof projectBacklogItemReadiness>[0]["activities"];

function implementation(activities: Activities, buildPlanDigest?: string | null) {
  return projectBacklogItemReadiness({
    item: { ...item, activeBuildKind: "feature" },
    activities,
    target: "implementation",
    transitionObject: { kind: "feature-build", id: "FB-1", expectedVersion: "plan", targetState: "build" },
    authorization: "pass",
    capsuleIdentity: "pass",
    evaluatedAt: "2026-08-24T00:00:00.000Z",
    buildPlanDigest,
  }).decision;
}

function stateOf(decision: ReturnType<typeof implementation>, code: string) {
  return [...decision.satisfied, ...decision.unmet, ...decision.blockers].find((entry) => entry.code === code)?.state;
}

describe("Build Studio plan coverage (BI-6F2872FC)", () => {
  it("owes the plan, its coverage and its traceability when the build recorded none", () => {
    const decision = implementation(withoutRepositoryPlan());
    expect(stateOf(decision, "PLAN_REQUIRED")).toBe("missing");
    expect(stateOf(decision, "PLAN_COVERAGE_REQUIRED")).toBe("missing");
    expect(stateOf(decision, "TRACEABILITY_INCOMPLETE")).toBe("missing");
  });

  it("satisfies the plan gates from coverage bound to the plan revision, and the plan review bound to that plan", () => {
    const decision = implementation([...withoutRepositoryPlan(), revisionCoverage(), planReviewOfPlan], PLAN_DIGEST);
    expect(decision.verdict).toBe("allowed");
  });

  it("still owes an independent plan review of that plan", () => {
    const decision = implementation([...withoutRepositoryPlan(), revisionCoverage()], PLAN_DIGEST);
    expect(stateOf(decision, "PLAN_REQUIRED")).toBe("pass");
    expect(stateOf(decision, "PLAN_REVIEW_REQUIRED")).toBe("missing");
    expect(decision.verdict).not.toBe("allowed");
  });

  it("reads a plan review of a different plan as stale", () => {
    const other = { ...planReviewOfPlan, payload: { ...planReviewOfPlan.payload, artifactDigest: `sha256:${"d".repeat(64)}` } };
    const decision = implementation([...withoutRepositoryPlan(), revisionCoverage(), other], PLAN_DIGEST);
    expect(stateOf(decision, "PLAN_REVIEW_REQUIRED")).toBe("stale");
  });

  it("reads the coverage as stale once the build's plan changed", () => {
    const decision = implementation([...withoutRepositoryPlan(), revisionCoverage(), planReviewOfPlan], `sha256:${"e".repeat(64)}`);
    expect(stateOf(decision, "PLAN_REQUIRED")).toBe("stale");
    expect(decision.verdict).not.toBe("allowed");
  });
});
