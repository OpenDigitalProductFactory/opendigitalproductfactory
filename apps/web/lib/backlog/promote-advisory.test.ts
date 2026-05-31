import { describe, expect, it } from "vitest";

import { buildPromoteAdvisory, buildEpicLinkAdvisory } from "./promote-advisory";

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

describe("buildEpicLinkAdvisory", () => {
  it("warns when an untriaged item is linked to an epic (triage/promote unfinished)", () => {
    const advisory = buildEpicLinkAdvisory({
      itemId: "BI-6C86ADEB",
      targetEpicId: "EP-BUILD-STUDIO",
      triageOutcome: null,
      hasActiveBuild: false,
    });
    expect(advisory).not.toBeNull();
    expect(advisory).toContain("triage_backlog_item");
    expect(advisory).toContain("promote_to_build_studio");
    expect(advisory).toContain("organizational only");
    expect(advisory).toContain("Do NOT report this epic link");
  });

  it("warns when a build item with no build is linked to an epic", () => {
    const advisory = buildEpicLinkAdvisory({
      itemId: "BI-X",
      targetEpicId: "EP-BUILD-STUDIO",
      triageOutcome: "build",
      hasActiveBuild: false,
    });
    expect(advisory).not.toBeNull();
    expect(advisory).toContain("promote_to_build_studio");
    // build item is already triaged — should not tell it to triage again
    expect(advisory).not.toContain("not triaged yet");
  });

  it("stays silent when unlinking (no target epic)", () => {
    expect(
      buildEpicLinkAdvisory({
        itemId: "BI-X",
        targetEpicId: null,
        triageOutcome: null,
        hasActiveBuild: false,
      }),
    ).toBeNull();
  });

  it("stays silent for a build item that already has its build", () => {
    expect(
      buildEpicLinkAdvisory({
        itemId: "BI-X",
        targetEpicId: "EP-BUILD-STUDIO",
        triageOutcome: "build",
        hasActiveBuild: true,
      }),
    ).toBeNull();
  });

  it("stays silent for a triaged non-build outcome (no build expected)", () => {
    for (const outcome of ["defer", "reject", "discuss"]) {
      expect(
        buildEpicLinkAdvisory({
          itemId: "BI-X",
          targetEpicId: "EP-OTHER",
          triageOutcome: outcome,
          hasActiveBuild: false,
        }),
      ).toBeNull();
    }
  });
});
