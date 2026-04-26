import { describe, it, expect } from "vitest";
import { buildDependencyGraph, type PlanTask, type PlanFileEntry } from "./task-dependency-graph";

describe("buildDependencyGraph", () => {
  it("puts schema tasks in phase 1, API in phase 2, frontend in phase 3, QA last", () => {
    const files: PlanFileEntry[] = [
      { path: "packages/db/prisma/schema.prisma", action: "modify", purpose: "Add Complaint model" },
      { path: "apps/web/app/api/complaints/route.ts", action: "create", purpose: "CRUD API" },
      { path: "apps/web/components/complaints/ComplaintList.tsx", action: "create", purpose: "List UI" },
    ];
    const tasks: PlanTask[] = [
      { title: "Add Complaint schema", testFirst: "", implement: "", verify: "" },
      { title: "Create complaints API", testFirst: "", implement: "", verify: "" },
      { title: "Build complaints UI", testFirst: "", implement: "", verify: "" },
    ];

    const phases = buildDependencyGraph(files, tasks);

    expect(phases).toHaveLength(4); // schema, api, frontend, qa
    expect(phases[0]!.tasks[0]!.specialist).toBe("data-architect");
    expect(phases[1]!.tasks[0]!.specialist).toBe("software-engineer");
    expect(phases[2]!.tasks[0]!.specialist).toBe("software-engineer");
    expect(phases[3]!.tasks[0]!.specialist).toBe("qa-engineer");
  });

  it("groups independent tasks in the same phase for parallel execution", () => {
    const files: PlanFileEntry[] = [
      { path: "apps/web/app/api/foo/route.ts", action: "create", purpose: "Foo API" },
      { path: "apps/web/app/api/bar/route.ts", action: "create", purpose: "Bar API" },
    ];
    const tasks: PlanTask[] = [
      { title: "Create foo API", testFirst: "", implement: "", verify: "" },
      { title: "Create bar API", testFirst: "", implement: "", verify: "" },
    ];

    const phases = buildDependencyGraph(files, tasks);

    // Both are API tasks with no schema dependency — should be in same phase
    const apiPhase = phases.find(p => p.tasks.some(t => t.specialist === "software-engineer"));
    expect(apiPhase!.tasks).toHaveLength(2);
  });

  it("detects file overlap and sequences instead of parallelizing", () => {
    const files: PlanFileEntry[] = [
      { path: "apps/web/lib/shared.ts", action: "modify", purpose: "Add helper A" },
      { path: "apps/web/lib/shared.ts", action: "modify", purpose: "Add helper B" },
    ];
    const tasks: PlanTask[] = [
      { title: "Add helper A", testFirst: "", implement: "", verify: "" },
      { title: "Add helper B", testFirst: "", implement: "", verify: "" },
    ];

    const phases = buildDependencyGraph(files, tasks);

    // Same file — must be sequential, not parallel
    const taskPhases = phases.filter(p => p.tasks.some(t => t.specialist !== "qa-engineer"));
    const totalNonQaTasks = taskPhases.reduce((sum, p) => sum + p.tasks.length, 0);
    expect(totalNonQaTasks).toBe(2);
    // They should not be in the same phase
    expect(taskPhases.some(p => p.tasks.length > 1)).toBe(false);
  });

  it("always adds QA phase at the end", () => {
    const files: PlanFileEntry[] = [
      { path: "apps/web/components/Hello.tsx", action: "create", purpose: "UI" },
    ];
    const tasks: PlanTask[] = [
      { title: "Build hello component", testFirst: "", implement: "", verify: "" },
    ];

    const phases = buildDependencyGraph(files, tasks);
    const lastPhase = phases[phases.length - 1]!;
    expect(lastPhase.tasks[0]!.specialist).toBe("qa-engineer");
  });

  it("keeps visual regression tasks after implementation work", () => {
    const files: PlanFileEntry[] = [
      { path: "apps/web/components/build/BuildStudio.tsx", action: "modify", purpose: "Build Studio layout" },
      { path: "apps/web/components/build/ProcessGraph.tsx", action: "modify", purpose: "Workflow graph layout" },
    ];
    const tasks: PlanTask[] = [
      {
        title: "Stabilize workflow view shell layout",
        testFirst: "Open /build and confirm the overlap",
        implement: "Update the BuildStudio layout containers",
        verify: "Header and tabs remain visible",
      },
      {
        title: "Run targeted regression checks for constrained height and zoom safety",
        testFirst: "Define checks mapped to each acceptance criterion before final verification",
        implement: "Execute manual desktop checks at heights just above 600px and browser 200% zoom for Graph, Details, and Preview with active build selected",
        verify: "All acceptance criteria pass, including legibility of title/branch badge and no sidebar/right-header visual bleed",
      },
    ];

    const phases = buildDependencyGraph(files, tasks);
    const nonQaPhases = phases.filter((phase) => phase.tasks[0]?.specialist !== "qa-engineer");

    expect(nonQaPhases[0]?.tasks[0]?.title).toBe("Stabilize workflow view shell layout");
    expect(phases[phases.length - 1]?.tasks[0]?.specialist).toBe("qa-engineer");
  });

  it("handles empty plan gracefully", () => {
    const phases = buildDependencyGraph([], []);
    expect(phases).toHaveLength(1); // QA only
    expect(phases[0]!.tasks[0]!.specialist).toBe("qa-engineer");
  });
});
