// apps/web/components/build/ProcessGraphClickInfo.test.ts
//
// Unit tests for the pure helper that resolves a task-node label to its
// AssignedTask. ProcessGraph.tsx delegates to this when a parent opts
// into the onNodeClick callback; pinning the contract here keeps the
// click-info shape stable as the dependency-graph layer evolves.

import { describe, expect, it, vi } from "vitest";

import { lookupAssignedTaskByTitle } from "./ProcessGraphClickInfo";

vi.mock("@/lib/build/task-dependency-graph", () => ({
  buildDependencyGraph: (_fs: unknown, tasks: { title: string }[]) => {
    // Stub: pack all tasks into a single "phase" so the lookup walks them.
    return [
      { tasks: tasks.map((t) => ({ ...t, deps: [] })) },
    ];
  },
}));

function makeBuild(buildPlan: unknown): { buildPlan: unknown } {
  // FeatureBuildRow has lots of fields; the helper only reads .buildPlan.
  // Use a structural mock.
  return { buildPlan } as unknown as { buildPlan: unknown };
}

describe("lookupAssignedTaskByTitle", () => {
  it("returns null when build.buildPlan is null", () => {
    // Cast through unknown to satisfy the FeatureBuildRow contract for the helper.
    const result = lookupAssignedTaskByTitle(makeBuild(null) as never, "T1");
    expect(result).toBeNull();
  });

  it("returns null when tasks is missing/empty", () => {
    expect(
      lookupAssignedTaskByTitle(
        makeBuild({ fileStructure: [], tasks: [] }) as never,
        "T1",
      ),
    ).toBeNull();
    expect(
      lookupAssignedTaskByTitle(
        makeBuild({ fileStructure: [] }) as never,
        "T1",
      ),
    ).toBeNull();
  });

  it("returns the matching task when the title matches", () => {
    const result = lookupAssignedTaskByTitle(
      makeBuild({
        fileStructure: [],
        tasks: [
          { title: "T1: placement helper", implement: "..." },
          { title: "T2: PhaseMiniRail", implement: "..." },
        ],
      }) as never,
      "T2: PhaseMiniRail",
    );
    expect(result).not.toBeNull();
    expect(result?.title).toBe("T2: PhaseMiniRail");
  });

  it("returns null when no task title matches", () => {
    const result = lookupAssignedTaskByTitle(
      makeBuild({
        fileStructure: [],
        tasks: [
          { title: "T1: placement helper", implement: "..." },
        ],
      }) as never,
      "T999: nonexistent",
    );
    expect(result).toBeNull();
  });

  it("matches by exact title — does not match by substring", () => {
    const result = lookupAssignedTaskByTitle(
      makeBuild({
        fileStructure: [],
        tasks: [
          { title: "T1: placement helper", implement: "..." },
        ],
      }) as never,
      "placement helper", // partial
    );
    expect(result).toBeNull();
  });
});
