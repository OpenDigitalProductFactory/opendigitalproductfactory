import { describe, expect, it } from "vitest";

import { initiativeTextFromBuildValue } from "./artifact-resolver";
import { renderBuildPlanText } from "./render-build-plan-text";

const plan = {
  tasks: [
    { title: "Add the column", testFirst: "migration test", implement: "edit schema", verify: "prisma validate", satisfies: ["AC-2", "AC-1"] },
    { title: "Use it", testFirst: "unit", implement: "edit lib", verify: "vitest" },
  ],
  fileStructure: [{ path: "packages/db/prisma/schema/x.prisma", action: "modify", purpose: "column" }],
};

describe("renderBuildPlanText", () => {
  it("renders files and numbered tasks, naming the acceptance ids each task satisfies", () => {
    const text = renderBuildPlanText(plan)!;
    expect(text).toContain("## Files");
    expect(text).toContain("- modify `packages/db/prisma/schema/x.prisma` — column");
    expect(text).toContain("### Task 1: Add the column");
    expect(text).toContain("Satisfies: AC-2, AC-1");
    expect(text).toContain("### Task 2: Use it");
    expect(text).toContain("Satisfies: (none)");
  });

  it("is deterministic regardless of key order", () => {
    const reordered = { fileStructure: plan.fileStructure, tasks: plan.tasks.map((task) => Object.fromEntries(Object.entries(task).reverse())) };
    expect(renderBuildPlanText(reordered)).toBe(renderBuildPlanText(plan));
  });

  it("renders nothing for a value that is not a plan", () => {
    expect(renderBuildPlanText({ problemStatement: "x" })).toBeNull();
    expect(renderBuildPlanText({ tasks: [] })).toBeNull();
  });

  it("is the reviewable text of a stored plan revision", () => {
    expect(initiativeTextFromBuildValue(plan)).toBe(renderBuildPlanText(plan));
  });
});
