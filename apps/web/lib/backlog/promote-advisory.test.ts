import { describe, expect, it } from "vitest";

import { buildPromoteAdvisory } from "./promote-advisory";

describe("buildPromoteAdvisory", () => {
  it("warns when a build item with no active build is moved to in-progress", () => {
    const advisory = buildPromoteAdvisory({
      itemId: "BI-F9E7B780",
      targetStatus: "in-progress",
      triageOutcome: "build",
      hasActiveBuild: false,
    });
    expect(advisory).not.toBeNull();
    expect(advisory).toContain("BI-F9E7B780");
    expect(advisory).toContain("promote_to_build_studio");
    expect(advisory).toContain("does NOT create a build");
    expect(advisory).toContain("requires status=open");
    expect(advisory!.toLowerCase()).toContain("do not report");
  });

  it("stays silent when the build item already has an active build", () => {
    expect(
      buildPromoteAdvisory({
        itemId: "BI-1",
        targetStatus: "in-progress",
        triageOutcome: "build",
        hasActiveBuild: true,
      }),
    ).toBeNull();
  });

  it("stays silent for non-build items", () => {
    for (const outcome of ["runbook", "coworker-task", "defer", null]) {
      expect(
        buildPromoteAdvisory({
          itemId: "BI-2",
          targetStatus: "in-progress",
          triageOutcome: outcome,
          hasActiveBuild: false,
        }),
      ).toBeNull();
    }
  });

  it("stays silent for transitions other than in-progress", () => {
    for (const status of ["open", "done", "deferred", "triaging"]) {
      expect(
        buildPromoteAdvisory({
          itemId: "BI-3",
          targetStatus: status,
          triageOutcome: "build",
          hasActiveBuild: false,
        }),
      ).toBeNull();
    }
  });
});
