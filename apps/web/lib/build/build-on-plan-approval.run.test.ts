// BI-EB4BB4A0: runApprovedBuild is the run body of an approved plan's build.
// It is started by the `dispatch-build` Workroom effect, never fire-and-forget.
// It works only on a build already in `build`. It neither calls start_build
// nor writes the phase: the plan→build transition, with its gates, is the
// only phase move on this path. This file replaces the characterization of
// the retired `build-on-plan-approval` fallback write.
import { beforeEach, describe, expect, it, vi } from "vitest";

const trace = vi.hoisted(() => [] as string[]);
const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  userFindUnique: vi.fn(),
  executeTool: vi.fn(),
  orchestrator: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findUnique: (...a: unknown[]) => { trace.push("read:featureBuild"); return m.findUnique(...a); },
      update: (...a: unknown[]) => { trace.push("write:featureBuild"); return m.update(...a); },
    },
    buildActivity: {
      create: (...a: unknown[]) => {
        const data = (a[0] as { data: { tool: string; summary: string } }).data;
        trace.push(`activity:${data.tool}:${data.summary}`);
        return Promise.resolve({});
      },
    },
    user: { findUnique: (...a: unknown[]) => m.userFindUnique(...a) },
  },
}));
vi.mock("@/lib/mcp-tools", () => ({
  executeTool: (...a: unknown[]) => { trace.push(`tool:${String(a[0])}`); return m.executeTool(...a); },
}));
vi.mock("@/lib/build/build-orchestrator", () => ({
  runBuildOrchestrator: (...a: unknown[]) => { trace.push("orchestrator"); return m.orchestrator(...a); },
}));

import { runApprovedBuild } from "./build-on-plan-approval";

const BUILD = {
  phase: "build", buildPlan: { tasks: [{ title: "t1" }, { title: "t2" }] }, taskResults: null,
  threadId: "T1", title: "Feature", kind: "feature",
};

beforeEach(() => {
  trace.length = 0;
  vi.clearAllMocks();
  m.findUnique.mockResolvedValue(BUILD);
  m.userFindUnique.mockResolvedValue({ isSuperuser: true, groups: [{ platformRole: { roleId: "HR-000" } }] });
  m.orchestrator.mockResolvedValue({ totalTasks: 2, completedTasks: 2 });
});

describe("runApprovedBuild", () => {
  it("a build in build: runs the orchestrator once with the dispatching user's access, no start_build, no phase write", async () => {
    const out = await runApprovedBuild({ buildId: "FB-1", userId: "u1" });
    expect(out).toMatchObject({ kind: "dispatched-success", totalTasks: 2, completedTasks: 2 });
    expect(trace).toEqual([
      "read:featureBuild",
      "activity:build_dispatch:Dispatching build orchestrator: 2 tasks, parentThread=T1",
      "orchestrator",
      "activity:build_dispatch:Build orchestration complete: 2/2 tasks",
    ]);
    expect(m.orchestrator).toHaveBeenCalledWith(expect.objectContaining({ buildId: "FB-1", userId: "u1", platformRole: "HR-000", isSuperuser: true }));
    expect(m.executeTool).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("a build still in plan: skipped, nothing started and the phase untouched (the transition owns that move)", async () => {
    m.findUnique.mockResolvedValue({ ...BUILD, phase: "plan" });
    const out = await runApprovedBuild({ buildId: "FB-1", userId: "u1" });
    expect(out).toEqual({ kind: "skipped-wrong-phase", reason: "phase=plan" });
    expect(trace).not.toContain("orchestrator");
    expect(m.executeTool).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("every planned task already DONE (read from `outcome`, as results are stored): skipped, not re-run", async () => {
    m.findUnique.mockResolvedValue({
      ...BUILD,
      taskResults: { tasks: [{ title: "t1", outcome: "DONE" }, { title: "t2", outcome: "DONE_WITH_CONCERNS" }] },
    });
    const out = await runApprovedBuild({ buildId: "FB-1", userId: "u1" });
    expect(out).toEqual({ kind: "skipped-already-building", reason: "all tasks DONE" });
    expect(trace).not.toContain("orchestrator");
  });

  it("a partly finished build still runs; the orchestrator skips the finished tasks itself", async () => {
    m.findUnique.mockResolvedValue({ ...BUILD, taskResults: { tasks: [{ title: "t1", outcome: "DONE" }] } });
    const out = await runApprovedBuild({ buildId: "FB-1", userId: "u1" });
    expect(out.kind).toBe("dispatched-success");
  });

  it("dispatching user missing: dispatched-failure, the orchestrator never runs without an access context (BI-937E106A)", async () => {
    m.userFindUnique.mockResolvedValue(null);
    const out = await runApprovedBuild({ buildId: "FB-1", userId: "ghost" });
    expect(out).toMatchObject({ kind: "dispatched-failure", error: expect.stringContaining("ghost") });
    expect(trace).not.toContain("orchestrator");
  });

  it("orchestrator throws: reported as dispatched-failure, never rethrown", async () => {
    m.orchestrator.mockRejectedValue(new Error("engine gone"));
    const out = await runApprovedBuild({ buildId: "FB-1", userId: "u1" });
    expect(out).toMatchObject({ kind: "dispatched-failure", error: "engine gone" });
    expect(trace).toContain("activity:build_dispatch:Build dispatch failed: engine gone");
  });
});
