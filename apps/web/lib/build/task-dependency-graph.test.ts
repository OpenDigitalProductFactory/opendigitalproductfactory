import { describe, it, expect } from "vitest";
import {
  buildDependencyGraph,
  isRedundantVerificationTask,
  type PlanTask,
  type PlanFileEntry,
} from "./task-dependency-graph";

describe("isRedundantVerificationTask", () => {
  const t = (over: Partial<PlanTask>): PlanTask => ({ title: "", testFirst: "", implement: "", verify: "", ...over });

  it("flags explicit full/entire/all test-suite tasks", () => {
    expect(isRedundantVerificationTask(t({ title: "Run the full test suite" }))).toBe(true);
    expect(isRedundantVerificationTask(t({ title: "Run all tests" }))).toBe(true);
    expect(isRedundantVerificationTask(t({ title: "Full verification" }))).toBe(true);
    expect(isRedundantVerificationTask(t({ verify: "pnpm test" }))).toBe(true);
    expect(isRedundantVerificationTask(t({ implement: "pnpm -r test" }))).toBe(true);
  });

  it("does NOT flag a real implementation/test-writing task", () => {
    expect(isRedundantVerificationTask(t({ title: "Add classifySemanticId helper", implement: "write the function" }))).toBe(false);
    expect(isRedundantVerificationTask(t({ title: "Write unit tests for the helper", verify: "tests cover each kind" }))).toBe(false);
  });

  it("prunes redundant tasks while keeping the synthetic QA phase", () => {
    const files: PlanFileEntry[] = [
      { path: "apps/web/lib/utils/semanticIdClassifier.ts", action: "create", purpose: "helper" },
    ];
    const tasks: PlanTask[] = [
      { title: "Add classifySemanticId helper", testFirst: "", implement: "write helper", verify: "" },
      { title: "Run full test suite", testFirst: "", implement: "pnpm test", verify: "" },
      { title: "Full verification", testFirst: "", implement: "", verify: "run all tests" },
    ];
    const phases = buildDependencyGraph(files, tasks);
    const allTitles = phases.flatMap((p) => p.tasks.map((tk) => tk.title));
    expect(allTitles).not.toContain("Run full test suite");
    expect(allTitles.filter((x) => x === "Full verification: tests + typecheck")).toHaveLength(1);
    // Exactly one verification phase remains (the synthetic QA one).
    expect(phases[phases.length - 1]!.tasks[0]!.specialist).toBe("qa-engineer");
  });
});

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

  it("routes documentation path work to the documentation specialist before QA", () => {
    const files: PlanFileEntry[] = [
      { path: "docs/user-guide/build-studio/index.md", action: "modify", purpose: "Update Build Studio user guide" },
    ];
    const tasks: PlanTask[] = [
      {
        title: "Update user guide documentation",
        testFirst: "link check the edited page",
        implement: "Edit docs/user-guide/build-studio/index.md to document the new workflow",
        verify: "links resolve",
      },
    ];

    const phases = buildDependencyGraph(files, tasks);

    expect(phases[0]?.tasks[0]?.specialist).toBe("documentation-specialist");
    expect(phases[0]?.tasks[0]?.files[0]?.path).toBe("docs/user-guide/build-studio/index.md");
    expect(phases[phases.length - 1]?.tasks[0]?.specialist).toBe("qa-engineer");
  });

  it("routes explicit docs-impact tasks to the documentation specialist", () => {
    const files: PlanFileEntry[] = [
      { path: "apps/web/lib/actions/orders.ts", action: "modify", purpose: "Order workflow behavior" },
    ];
    const tasks: PlanTask[] = [
      {
        title: "Write docs impact attestation",
        testFirst: "review the changed workflow against the user guide",
        implement: "Update documentation or record a no-docs-needed attestation for the order workflow change",
        verify: "docs impact is explicit",
      },
    ];

    const phases = buildDependencyGraph(files, tasks);

    expect(phases[0]?.tasks[0]?.specialist).toBe("documentation-specialist");
  });

  it("routes prompt and agent registry docs work to the documentation specialist", () => {
    const files: PlanFileEntry[] = [
      { path: "prompts/build-phase/plan.prompt.md", action: "modify", purpose: "Add documentation impact planning guidance" },
      { path: "packages/db/data/agent_registry.json", action: "modify", purpose: "Update documentation specialist capability wording" },
    ];
    const tasks: PlanTask[] = [
      {
        title: "Update Build Studio prompt documentation guidance",
        testFirst: "Review prompt wording against the definition of done",
        implement: "Edit prompts/build-phase/plan.prompt.md and packages/db/data/agent_registry.json",
        verify: "Build Studio coworkers receive docs-impact guidance",
      },
    ];

    const phases = buildDependencyGraph(files, tasks);

    expect(phases[0]?.tasks[0]?.specialist).toBe("documentation-specialist");
  });

  it("handles empty plan gracefully", () => {
    const phases = buildDependencyGraph([], []);
    expect(phases).toHaveLength(1); // QA only
    expect(phases[0]!.tasks[0]!.specialist).toBe("qa-engineer");
  });

  it("does not throw when fileStructure is undefined and tasks exist", () => {
    // Regression: a stored buildPlan with `{ tasks: [...] }` but no
    // `fileStructure` used to crash the /build page when the build was
    // selected. The static type declares fileStructure required, but the
    // Prisma JSON column does not enforce that at runtime.
    const tasks: PlanTask[] = [
      { title: "Add AgentBudgetEvent Prisma model and run migration", testFirst: "", implement: "", verify: "" },
    ];

    expect(() => buildDependencyGraph(undefined, tasks)).not.toThrow();
    expect(() => buildDependencyGraph(null, tasks)).not.toThrow();

    const phases = buildDependencyGraph(undefined, tasks);
    expect(phases.length).toBeGreaterThan(0);
    // QA phase is always appended last.
    expect(phases[phases.length - 1]?.tasks[0]?.specialist).toBe("qa-engineer");
  });

  it("does not throw when legacy file entries omit purpose", () => {
    // Regression: PR-generated buildPlan JSON can store fileStructure entries
    // as `{ path, change }`. The graph should tolerate that legacy shape
    // instead of crashing /build while matching task keywords.
    const files = [
      {
        path: "apps/web/lib/feedback/feedback-event.ts",
        change: "Restrict trigger vocabulary to spec section 6.1.",
      },
    ] as unknown as PlanFileEntry[];
    const tasks: PlanTask[] = [
      {
        title: "Align feedback event contract",
        testFirst: "",
        implement: "",
        verify: "",
      },
    ];

    expect(() => buildDependencyGraph(files, tasks)).not.toThrow();

    const phases = buildDependencyGraph(files, tasks);
    expect(phases[0]?.tasks[0]?.files[0]?.path).toBe("apps/web/lib/feedback/feedback-event.ts");
  });
});
