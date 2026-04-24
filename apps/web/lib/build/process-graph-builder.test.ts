import { describe, it, expect } from "vitest";
import {
  buildPhaseGraph,
  buildTaskGraph,
  getPhaseNodeStatus,
  getTaskNodeStatus,
  normalizeBuildSnapshot,
  type GraphOutput,
  type NormalizedBuildProcessSnapshot,
  type PhaseNodeData,
  type TaskNodeData,
  type ProcessActorKind,
  type NodeStatus,
} from "./process-graph-builder";
import {
  normalizeHappyPathState,
  type FeatureBuildRow,
} from "@/lib/explore/feature-build-types";

// Minimal FeatureBuildRow stub
function makeRow(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    id: "1",
    buildId: "FB-TEST",
    title: "Test Build",
    description: null,
    portfolioId: null,
    brief: null,
    plan: null,
    phase: "plan",
    sandboxId: null,
    sandboxPort: null,
    diffSummary: null,
    diffPatch: null,
    codingProvider: null,
    threadId: null,
    digitalProductId: null,
    product: null,
    createdById: "u1",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    designDoc: null,
    designReview: null,
    buildPlan: null,
    planReview: null,
    taskResults: null,
    verificationOut: null,
    acceptanceMet: null,
    scoutFindings: null,
     uxTestResults: null,
     uxVerificationStatus: null,
     deliberationSummary: null,
     accountableEmployeeId: null,
    claimedByAgentId: null,
    claimedAt: null,
    claimStatus: null,
    buildExecState: null,
    phaseHandoffs: null,
    happyPathState: normalizeHappyPathState(null),
    ...overrides,
  };
}

describe("getPhaseNodeStatus", () => {
  it("returns done for phases before the current phase", () => {
    const row = makeRow({ phase: "build" });
    expect(getPhaseNodeStatus("ideate", row)).toBe("done");
    expect(getPhaseNodeStatus("plan", row)).toBe("done");
  });

  it("returns running for the current phase", () => {
    const row = makeRow({ phase: "build" });
    expect(getPhaseNodeStatus("build", row)).toBe("running");
  });

  it("returns pending for phases after the current phase", () => {
    const row = makeRow({ phase: "build" });
    expect(getPhaseNodeStatus("review", row)).toBe("pending");
    expect(getPhaseNodeStatus("ship", row)).toBe("pending");
  });

  it("returns done for all visible phases when complete", () => {
    const row = makeRow({ phase: "complete" });
    expect(getPhaseNodeStatus("ideate", row)).toBe("done");
    expect(getPhaseNodeStatus("ship", row)).toBe("done");
  });

  it("returns error for the active phase when build has failed", () => {
    const row = makeRow({ phase: "failed", phaseHandoffs: [
      { fromPhase: "ideate", toPhase: "plan", fromAgentId: "a1", toAgentId: "a2",
        summary: "", evidenceDigest: {}, createdAt: new Date() },
    ] });
    expect(getPhaseNodeStatus("ideate", row)).toBe("done");
    expect(getPhaseNodeStatus("plan", row)).toBe("error");
  });
});

describe("buildPhaseGraph", () => {
  it("returns 5 phase nodes and 4 edges", () => {
    const row = makeRow({ phase: "plan" });
    const { nodes, edges } = buildPhaseGraph(row);
    expect(nodes).toHaveLength(5);
    expect(edges).toHaveLength(4);
  });

  it("positions nodes left-to-right with 280px spacing", () => {
    const row = makeRow({ phase: "ideate" });
    const { nodes } = buildPhaseGraph(row);
    const ideate = nodes.find((n) => n.id === "phase-ideate");
    const plan = nodes.find((n) => n.id === "phase-plan");
    expect(ideate).toBeDefined();
    expect(plan).toBeDefined();
    expect((plan!.position.x) - (ideate!.position.x)).toBe(280);
  });

  it("node data includes status, color, label, and icon", () => {
    const row = makeRow({ phase: "build" });
    const { nodes } = buildPhaseGraph(row);
    const buildNode = nodes.find((n) => n.id === "phase-build");
    const data = buildNode?.data as PhaseNodeData | undefined;
    expect(data?.status).toBe("running");
    expect(data?.label).toBe("Build");
    expect(typeof data?.icon).toBe("string");
  });

  it("includes deliberation metadata when a phase summary exists", () => {
    const row = makeRow({
      phase: "plan",
      deliberationSummary: {
        plan: {
          patternSlug: "debate",
          deliberationRunId: "del-1",
          consensusState: "partial-consensus",
          rationaleSummary: "Two models agreed on the core approach but disagreed on sourcing freshness.",
          evidenceQuality: "mixed",
          unresolvedRisks: ["Fresh provider checks still needed."],
          diversityLabel: "Multi-provider review",
        },
      },
    });
    const { nodes } = buildPhaseGraph(row);
    const planNode = nodes.find((n) => n.id === "phase-plan");
    const data = planNode?.data as PhaseNodeData | undefined;
    expect(data?.deliberationLabel).toBe("Debate");
    expect(data?.deliberationState).toBe("partial-consensus");
  });

  it("edge source/target reference correct node ids", () => {
    const row = makeRow({ phase: "ideate" });
    const { edges } = buildPhaseGraph(row);
    expect(edges[0]?.source).toBe("phase-ideate");
    expect(edges[0]?.target).toBe("phase-plan");
  });
});

function makeTaskResults(tasks: Array<{ title: string; outcome: string }>) {
  return {
    completedTasks: tasks.filter(t => t.outcome === "DONE").length,
    totalTasks: tasks.length,
    timedOut: false,
    tasks: tasks.map(t => ({ title: t.title, specialist: "software-engineer", outcome: t.outcome, durationMs: 0 })),
    timestamp: new Date().toISOString(),
  } as unknown as FeatureBuildRow["taskResults"];
}

function makeSnapshot(
  row: FeatureBuildRow,
  activeTaskTitles: Set<string> = new Set(),
): NormalizedBuildProcessSnapshot {
  return normalizeBuildSnapshot(row, activeTaskTitles);
}

describe("getTaskNodeStatus", () => {
  it("returns pending when taskResults is null", () => {
    const row = makeRow({ taskResults: null });
    const snap = makeSnapshot(row);
    expect(getTaskNodeStatus("Add schema", row, snap)).toBe("pending");
  });

  it("returns done when title matches and outcome is DONE", () => {
    const row = makeRow({ taskResults: makeTaskResults([{ title: "Add schema", outcome: "DONE" }]) });
    const snap = makeSnapshot(row);
    expect(getTaskNodeStatus("Add schema", row, snap)).toBe("done");
  });

  it("returns done when outcome is DONE_WITH_CONCERNS", () => {
    const row = makeRow({ taskResults: makeTaskResults([{ title: "Add schema", outcome: "DONE_WITH_CONCERNS" }]) });
    const snap = makeSnapshot(row);
    expect(getTaskNodeStatus("Add schema", row, snap)).toBe("done");
  });

  it("returns error when title matches and outcome is not a DONE variant", () => {
    const row = makeRow({
      phase: "build",
      taskResults: makeTaskResults([{ title: "Add API route", outcome: "FAILED" }]),
    });
    const snap = makeSnapshot(row);
    expect(getTaskNodeStatus("Add API route", row, snap)).toBe("error");
  });

  it("returns running when activeTaskTitles contains the task", () => {
    const row = makeRow({
      phase: "build",
      taskResults: makeTaskResults([{ title: "Add schema", outcome: "DONE" }]),
    });
    const snap = makeSnapshot(row, new Set(["Add API route"]));
    expect(getTaskNodeStatus("Add API route", row, snap)).toBe("running");
  });

  it("supports multiple parallel tasks running simultaneously", () => {
    const row = makeRow({
      phase: "build",
      taskResults: makeTaskResults([{ title: "Add schema", outcome: "DONE" }]),
    });
    const snap = makeSnapshot(row, new Set(["Add API route", "Add frontend page"]));
    expect(getTaskNodeStatus("Add API route", row, snap)).toBe("running");
    expect(getTaskNodeStatus("Add frontend page", row, snap)).toBe("running");
    expect(getTaskNodeStatus("Add schema", row, snap)).toBe("done");
  });

  it("returns pending when phase is not build and task has no result", () => {
    const row = makeRow({ phase: "plan", taskResults: null });
    const snap = makeSnapshot(row);
    expect(getTaskNodeStatus("Add schema", row, snap)).toBe("pending");
  });
});

describe("buildTaskGraph", () => {
  it("returns empty nodes and edges when buildPlan is null", () => {
    const row = makeRow({ buildPlan: null });
    const snap = makeSnapshot(row);
    const { nodes, edges } = buildTaskGraph(row, snap);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it("generates task nodes for a sequential plan", () => {
    const row = makeRow({
      phase: "build",
      buildPlan: {
        fileStructure: [
          { path: "packages/db/prisma/schema.prisma", action: "modify", purpose: "add table" },
          { path: "apps/web/app/api/foo/route.ts", action: "create", purpose: "api route" },
        ],
        tasks: [
          { title: "Add schema", testFirst: "", implement: "", verify: "" },
          { title: "Add API route", testFirst: "", implement: "", verify: "" },
        ],
      },
    });
    const snap = makeSnapshot(row);
    const { nodes } = buildTaskGraph(row, snap);
    const taskNodes = nodes.filter((n) => n.type === "processTask");
    expect(taskNodes.length).toBeGreaterThanOrEqual(2);
  });

  it("generates fork/join nodes for parallel phases", () => {
    const row = makeRow({
      phase: "build",
      buildPlan: {
        fileStructure: [
          { path: "apps/web/app/api/foo/route.ts", action: "create", purpose: "api A" },
          { path: "apps/web/app/api/bar/route.ts", action: "create", purpose: "api B" },
        ],
        tasks: [
          { title: "Add foo API", testFirst: "", implement: "", verify: "" },
          { title: "Add bar API", testFirst: "", implement: "", verify: "" },
        ],
      },
    });
    const snap = makeSnapshot(row);
    const { nodes } = buildTaskGraph(row, snap);
    const forkJoinNodes = nodes.filter((n) => n.type === "processForkJoin");
    expect(forkJoinNodes.length).toBeGreaterThanOrEqual(2); // at least one fork + one join
  });

  it("task nodes include actor provenance from the snapshot", () => {
    const row = makeRow({
      phase: "build",
      buildPlan: {
        fileStructure: [
          { path: "packages/db/prisma/schema.prisma", action: "modify", purpose: "add table" },
        ],
        tasks: [
          { title: "Add schema", testFirst: "", implement: "", verify: "" },
        ],
      },
    });
    const snap = makeSnapshot(row);
    const { nodes } = buildTaskGraph(row, snap);
    const taskNode = nodes.find((n) => n.type === "processTask");
    const taskData = taskNode?.data as TaskNodeData | undefined;
    expect(taskData?.actorKind).toBe("ai_coworker");
    expect(typeof taskData?.actorLabel).toBe("string");
  });
});
