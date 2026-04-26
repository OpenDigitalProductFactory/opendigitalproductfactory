import { describe, expect, it } from "vitest";
import { normalizeBuildPlanPaths } from "./build-plan-paths";
import type { BuildPlanDoc } from "@/lib/explore/feature-build-types";

function makePlan(overrides: Partial<BuildPlanDoc> = {}): BuildPlanDoc {
  return {
    fileStructure: [],
    tasks: [],
    ...overrides,
  };
}

describe("normalizeBuildPlanPaths", () => {
  it("rewrites legacy Build Studio component paths to the current build directory", () => {
    const plan = makePlan({
      fileStructure: [
        {
          path: "apps/web/components/build-studio/WorkflowGraphPanel.tsx",
          action: "modify",
          purpose: "Constrain graph canvas",
        },
      ],
      tasks: [
        {
          title: "Update graph panel",
          testFirst: "Inspect the current graph panel and WorkflowGraphPanel layout",
          implement: "Edit apps/web/components/build-studio/WorkflowGraphPanel.tsx to constrain overflow in WorkflowGraphPanel",
          verify: "Graph stays inside its panel",
        },
      ],
    });

    const normalized = normalizeBuildPlanPaths(plan, {
      exists: (absolutePath) => absolutePath.replace(/\\/g, "/").endsWith("/apps/web/components/build/ProcessGraph.tsx"),
    });

    expect(normalized.plan.fileStructure[0]?.path).toBe("apps/web/components/build/ProcessGraph.tsx");
    expect(normalized.plan.tasks[0]?.implement).toContain("apps/web/components/build/ProcessGraph.tsx");
    expect(normalized.plan.tasks[0]?.implement).toContain("ProcessGraph");
    expect(normalized.plan.tasks[0]?.implement).not.toContain("WorkflowGraphPanel");
    expect(normalized.plan.tasks[0]?.testFirst).toContain("ProcessGraph");
    expect(normalized.rewrites).toEqual([
      {
        from: "apps/web/components/build-studio/WorkflowGraphPanel.tsx",
        to: "apps/web/components/build/ProcessGraph.tsx",
      },
    ]);
    expect(normalized.unresolvedModifyPaths).toEqual([]);
  });

  it("flags modify targets that still cannot be grounded in the repo", () => {
    const plan = makePlan({
      fileStructure: [
        {
          path: "apps/web/components/build-studio/MissingPanel.tsx",
          action: "modify",
          purpose: "Broken reference",
        },
      ],
      tasks: [
        {
          title: "Fix missing panel",
          testFirst: "Open the panel",
          implement: "Edit apps/web/components/build-studio/MissingPanel.tsx",
          verify: "Panel renders",
        },
      ],
    });

    const normalized = normalizeBuildPlanPaths(plan, {
      exists: () => false,
    });

    expect(normalized.plan.fileStructure[0]?.path).toBe("apps/web/components/build-studio/MissingPanel.tsx");
    expect(normalized.unresolvedModifyPaths).toEqual([
      "apps/web/components/build-studio/MissingPanel.tsx",
    ]);
  });
});
