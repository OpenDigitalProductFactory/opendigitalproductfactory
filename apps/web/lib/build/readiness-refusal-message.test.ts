// BI-C5D978E9 — the owner must be able to read a readiness refusal.

import { describe, expect, it } from "vitest";

import { describeReadinessRefusal } from "./readiness-refusal-message";

describe("describeReadinessRefusal", () => {
  // The live repro: FB-EB292B9F, whose design had PASSED review and sized ok.
  it("turns the six-code plan refusal into something a shelter director can read", () => {
    const message = describeReadinessRefusal("plan", [
      { code: "RESEARCH_REQUIRED", accountableRole: "design-author" },
      { code: "CANONICAL_DESIGN_REQUIRED", accountableRole: "design-checklist-reviewer" },
      { code: "SPEC_APPROVAL_REQUIRED", accountableRole: "design-checklist-reviewer" },
      { code: "REVIEW_REQUIRED", accountableRole: "architecture-reviewer" },
      { code: "OBJECTIVE_BASELINE_REQUIRED", accountableRole: "design-checklist-reviewer" },
      { code: "ARTIFACT_AUTHOR_REQUIRED", accountableRole: "artifact-resolver" },
    ]);

    expect(message).toContain("cannot move into plan yet");
    expect(message).toContain("the research behind this design has not been recorded");
    expect(message).toContain("an architecture reviewer");
    // The load-bearing sentence: it is not the owner who is holding this up.
    expect(message).toContain("nothing here is waiting on your input");
    // No raw enum codes survive.
    expect(message).not.toMatch(/[A-Z]+_REQUIRED/);
  });

  it("reads naturally for a single missing requirement", () => {
    const message = describeReadinessRefusal("plan", [
      { code: "REVIEW_REQUIRED", accountableRole: "architecture-reviewer" },
    ]);
    expect(message).toContain("because an independent review has not been recorded (an architecture reviewer)");
    expect(message).not.toContain(";");
  });

  it("still renders an unknown code rather than dropping it", () => {
    const message = describeReadinessRefusal("build", [{ code: "SOMETHING_NEW" }]);
    expect(message).toContain("SOMETHING_NEW");
  });

  it("says something when there is nothing to describe", () => {
    expect(describeReadinessRefusal("plan", [])).toBe("Cannot enter plan.");
  });
});
