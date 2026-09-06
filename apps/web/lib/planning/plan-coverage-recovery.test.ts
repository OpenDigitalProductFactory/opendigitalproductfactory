import { describe, expect, it } from "vitest";

import { projectMissingBaselineRecovery } from "./plan-coverage-recovery";

describe("projectMissingBaselineRecovery", () => {
  it.each([
    ["feature", "scope-baseline-review-required"],
    ["bug", "implementation-parent-binding-required"],
    ["doc", "implementation-parent-binding-required"],
  ])("returns an executable recovery for %s work", (workType, recoveryKind) => {
    const result = projectMissingBaselineRecovery({
      item: { itemId: "BI-PARENT", workType },
      mappedItems: [],
    });

    expect(result.recovery).toMatchObject({ kind: recoveryKind });
    if (workType === "feature") expect(result.instruction).toContain("spec-approval `request_coworker`");
    else expect(result.instruction).not.toContain("reviewer route verbatim");
  });

  it("points a documentation parent at its mapped feature child", () => {
    const result = projectMissingBaselineRecovery({
      item: { itemId: "BI-DOC-PARENT", workType: "doc" },
      mappedItems: [{ itemId: "BI-FEATURE-CHILD", workType: "feature" }],
    });

    expect(result.recovery).toMatchObject({
      kind: "implementation-parent-binding-required",
      documentationItemId: "BI-DOC-PARENT",
      candidateImplementationItemIds: ["BI-FEATURE-CHILD"],
      nextTool: "record_plan_backlog_coverage",
    });
    expect(result.instruction).toContain("BI-FEATURE-CHILD");
  });
});
