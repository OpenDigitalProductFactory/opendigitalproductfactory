import { describe, expect, it } from "vitest";

import { planNamesNoFiles, shouldReviseRejectedPlan } from "./plan-review-advisory";

describe("plan review advisory rules (BI-A87DE5E1)", () => {
  // FB-F88BFE10, 2026-09-24: a one-task "regenerate the plan" meta-plan with no
  // files failed review, the review was ADVISORY for a small fix, and the build
  // advanced and coded against it — ten inspection commands, no file changed.
  it("treats a plan that names no files as not a plan", () => {
    expect(planNamesNoFiles({ fileStructure: [], tasks: [{ title: "Regenerate the plan" }] })).toBe(true);
    expect(planNamesNoFiles(null)).toBe(true);
    expect(planNamesNoFiles({ fileStructure: [{ path: " " }], tasks: [] })).toBe(true);
    expect(planNamesNoFiles({ fileStructure: [{ path: "scripts/a.mjs", action: "modify" }], tasks: [] })).toBe(false);
  });

  // The revision loop then rewrote buildPlan (a good 2-task plan, 03:08) under an
  // orchestrator already running the rejected one (dispatched 03:07).
  it("stops revising once the build has left plan", () => {
    expect(shouldReviseRejectedPlan({ decision: "fail" }, "plan")).toBe(true);
    expect(shouldReviseRejectedPlan({ decision: "fail" }, "build")).toBe(false);
    expect(shouldReviseRejectedPlan({ decision: "pass" }, "plan")).toBe(false);
    expect(shouldReviseRejectedPlan(null, "plan")).toBe(false);
  });
});
