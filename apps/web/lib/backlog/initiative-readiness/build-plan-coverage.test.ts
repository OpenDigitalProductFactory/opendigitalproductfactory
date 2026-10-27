import { describe, expect, it } from "vitest";

import {
  BUILD_PLAN_COVERAGE_SCHEMA_VERSION,
  BUILD_PLAN_COVERAGE_SOURCE,
  buildPlanCoveragePayload,
  projectBuildPlanCoverage,
  traceBuildPlanToAcceptance,
} from "./build-plan-coverage";

const DIGEST = `sha256:${"a".repeat(64)}`;
const baseline = { baselineId: "baseline-1", artifactDigest: "sha256:design" };

function plan(...satisfies: Array<string[] | undefined>) {
  return {
    fileStructure: [{ path: "apps/web/lib/x.ts", action: "create", purpose: "x" }],
    tasks: satisfies.map((refs, index) => ({
      title: `Task ${index + 1}`,
      testFirst: "t",
      implement: "i",
      verify: "v",
      ...(refs ? { satisfies: refs } : {}),
    })),
  };
}

describe("traceBuildPlanToAcceptance", () => {
  it("is complete when every baseline acceptance id is satisfied by some task", () => {
    const trace = traceBuildPlanToAcceptance(plan(["AC-1"], ["AC-2", "AC-1"]), ["AC-1", "AC-2"]);
    expect(trace).toEqual({
      complete: true,
      tasks: [
        { index: 0, title: "Task 1", satisfies: ["AC-1"] },
        { index: 1, title: "Task 2", satisfies: ["AC-2", "AC-1"] },
      ],
    });
  });

  it("names the acceptance ids no task satisfies", () => {
    const trace = traceBuildPlanToAcceptance(plan(["AC-1"], undefined), ["AC-1", "AC-2", "AC-3"]);
    expect(trace).toMatchObject({ complete: false, reason: "acceptance-uncovered", uncovered: ["AC-2", "AC-3"] });
  });

  it("refuses a plan whose tasks carry no satisfies at all, as a legacy plan", () => {
    const trace = traceBuildPlanToAcceptance(plan(undefined, undefined), ["AC-1"]);
    expect(trace).toMatchObject({ complete: false, reason: "plan-untraced" });
  });

  it("refuses a reference to an acceptance id the baseline does not hold", () => {
    const trace = traceBuildPlanToAcceptance(plan(["AC-1", "AC-9"]), ["AC-1"]);
    expect(trace).toMatchObject({ complete: false, reason: "unknown-acceptance-ref", unknownRefs: ["AC-9"] });
  });

  it("refuses when the baseline carries no acceptance ids — nothing can be traced", () => {
    expect(traceBuildPlanToAcceptance(plan(["AC-1"]), [])).toMatchObject({ complete: false, reason: "baseline-without-acceptance" });
  });

  it("refuses a value that is not a plan with tasks", () => {
    expect(traceBuildPlanToAcceptance(null, ["AC-1"])).toMatchObject({ complete: false, reason: "no-plan-tasks" });
    expect(traceBuildPlanToAcceptance({ tasks: [] }, ["AC-1"])).toMatchObject({ complete: false, reason: "no-plan-tasks" });
  });
});

function payload() {
  const trace = traceBuildPlanToAcceptance(plan(["AC-1"]), ["AC-1"]);
  if (!trace.complete) throw new Error("fixture");
  return buildPlanCoveragePayload({
    itemId: "BI-1",
    buildId: "FB-1",
    revisionId: "rev-plan",
    planDigest: DIGEST,
    baseline,
    acceptanceIds: ["AC-1"],
    trace,
    recordedAt: "2026-10-21T00:00:00.000Z",
  });
}

describe("buildPlanCoveragePayload", () => {
  it("binds the coverage to the plan revision and the current baseline, mapping the item atomically", () => {
    expect(payload()).toMatchObject({
      schemaVersion: BUILD_PLAN_COVERAGE_SCHEMA_VERSION,
      source: BUILD_PLAN_COVERAGE_SOURCE,
      decision: "atomic",
      planPath: null,
      planArtifactRef: { kind: "feature-build-revision", field: "buildPlan", revisionId: "rev-plan", buildId: "FB-1" },
      planArtifactDigest: DIGEST,
      scopeBaselineId: "baseline-1",
      scopeBaselineArtifactDigest: "sha256:design",
      mappedItemIds: ["BI-1"],
      sourceBuildId: "FB-1",
      deliverables: [{ backlogItemId: "BI-1", verificationRefs: ["AC-1"] }],
    });
  });
});

describe("projectBuildPlanCoverage", () => {
  it("is not a build-plan coverage record when the plan artifact is a repository blob", () => {
    expect(projectBuildPlanCoverage({ schemaVersion: 2, planArtifactRef: { kind: "repo-blob-at-commit" } }, baseline)).toBeNull();
  });

  it("passes against the baseline it was recorded for", () => {
    expect(projectBuildPlanCoverage(payload(), baseline)).toEqual({ state: "pass", planDigest: DIGEST });
  });

  it("passes when the build's current plan is the covered revision", () => {
    expect(projectBuildPlanCoverage(payload(), baseline, DIGEST)).toEqual({ state: "pass", planDigest: DIGEST });
    expect(projectBuildPlanCoverage(payload(), baseline, "a".repeat(64))).toEqual({ state: "pass", planDigest: DIGEST });
  });

  it("is stale once the build's plan changed after coverage was recorded", () => {
    expect(projectBuildPlanCoverage(payload(), baseline, `sha256:${"b".repeat(64)}`))
      .toEqual({ state: "stale", planDigest: DIGEST });
  });

  it("is stale once the scope baseline moved on", () => {
    expect(projectBuildPlanCoverage(payload(), { baselineId: "baseline-2", artifactDigest: "sha256:design2" }))
      .toEqual({ state: "stale", planDigest: DIGEST });
    expect(projectBuildPlanCoverage(payload(), null)).toEqual({ state: "stale", planDigest: DIGEST });
  });

  it("is malformed when the record lost its binding or its trace", () => {
    const base = payload() as Record<string, unknown>;
    expect(projectBuildPlanCoverage({ ...base, planArtifactDigest: "sha256:short" }, baseline)?.state).toBe("malformed");
    expect(projectBuildPlanCoverage({ ...base, planArtifactRef: { kind: "feature-build-revision", field: "buildPlan" } }, baseline)?.state).toBe("malformed");
    expect(projectBuildPlanCoverage({ ...base, deliverables: [] }, baseline)?.state).toBe("malformed");
    expect(projectBuildPlanCoverage({ ...base, source: "someone-else" }, baseline)?.state).toBe("malformed");
  });
});
