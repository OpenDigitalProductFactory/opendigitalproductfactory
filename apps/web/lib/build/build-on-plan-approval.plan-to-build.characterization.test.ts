// GPP Phase 2 PR-F (C-8, BI-45F9CB7A) — characterization of the plan→build write
// in `dispatchBuildForApprovedPlan`. Written against the tree BEFORE the
// shared-transition refactor and kept unchanged after it. It pins: the only
// checks before the write are initiative readiness (upstream, in this dispatch)
// and a successful `start_build` that set `buildBranch`; there is no structural
// phase gate and no WWMD call here, and no gate-skipped event is recorded.
import { beforeEach, describe, expect, it, vi } from "vitest";

const trace = vi.hoisted(() => [] as string[]);
const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  activityCreate: vi.fn(),
  userFindUnique: vi.fn(),
  initiative: vi.fn(),
  executeTool: vi.fn(),
  orchestrator: vi.fn(),
  phaseGate: vi.fn(),
  wwmd: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findUnique: (...a: unknown[]) => { trace.push("read:featureBuild"); return m.findUnique(...a); },
      update: (...a: unknown[]) => {
        trace.push(`write:${JSON.stringify((a[0] as { data: unknown }).data)}`);
        return m.update(...a);
      },
    },
    buildActivity: {
      create: (...a: unknown[]) => {
        const data = (a[0] as { data: { tool: string; summary: string } }).data;
        trace.push(`activity:${data.tool}:${data.summary}`);
        return m.activityCreate(...a);
      },
    },
    user: { findUnique: (...a: unknown[]) => m.userFindUnique(...a) },
  },
}));
vi.mock("@/lib/build/build-entry-gate", () => ({
  enforceBuildInitiativeReadiness: (...a: unknown[]) => { trace.push("gate:initiative-readiness"); return m.initiative(...a); },
}));
vi.mock("@/lib/mcp-tools", () => ({
  executeTool: (...a: unknown[]) => { trace.push(`tool:${String(a[0])}`); return m.executeTool(...a); },
}));
vi.mock("@/lib/build/build-orchestrator", () => ({
  runBuildOrchestrator: (...a: unknown[]) => { trace.push("orchestrator"); return m.orchestrator(...a); },
}));
vi.mock("@/lib/work-posture/verification-depth-gate", () => ({
  checkBuildPhaseGate: (...a: unknown[]) => { trace.push("gate:structural-phase-gate"); return m.phaseGate(...a); },
}));
vi.mock("@/lib/decision-perspective/build-studio-gate", () => ({
  evaluateBuildStudioPlanAdvancementGate: (...a: unknown[]) => { trace.push("gate:wwmd-plan-advancement"); return m.wwmd(...a); },
}));

import { dispatchBuildForApprovedPlan } from "./build-on-plan-approval";

const BUILD = {
  phase: "plan", buildPlan: { tasks: [{ title: "t" }] }, taskResults: null,
  threadId: "T1", title: "Feature", kind: "feature",
};

beforeEach(() => {
  trace.length = 0;
  vi.clearAllMocks();
  m.update.mockResolvedValue({});
  m.activityCreate.mockResolvedValue({});
  m.userFindUnique.mockResolvedValue({ isSuperuser: true, groups: [{ platformRole: { roleId: "HR-000" } }] });
  m.initiative.mockResolvedValue({ allowed: true, message: "allowed" });
  m.executeTool.mockResolvedValue({ success: true });
  m.orchestrator.mockResolvedValue({ totalTasks: 1, completedTasks: 1 });
});

describe("characterization: dispatchBuildForApprovedPlan plan→build write", () => {
  it("plan + branch after start_build: one write, then the dispatch log and the orchestrator", async () => {
    m.findUnique
      .mockResolvedValueOnce(BUILD)
      .mockResolvedValueOnce({ phase: "plan", buildBranch: "build/FB-1" });
    const out = await dispatchBuildForApprovedPlan({ buildId: "FB-1", userId: "u1" });
    expect(out).toMatchObject({ kind: "dispatched-success", totalTasks: 1, completedTasks: 1 });
    expect(trace).toEqual([
      "read:featureBuild",
      "gate:initiative-readiness",
      "tool:start_build",
      "activity:build_dispatch:start_build succeeded — sandbox ready, build branch initialized",
      "read:featureBuild",
      'write:{"phase":"build"}',
      "activity:build_dispatch:Phase advanced to build (start_build confirmed sandbox ready)",
      "activity:build_dispatch:Dispatching build orchestrator: 1 tasks, parentThread=T1",
      "orchestrator",
      "activity:build_dispatch:Build orchestration complete: 1/1 tasks",
    ]);
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenCalledWith({ where: { buildId: "FB-1" }, data: { phase: "build" } });
    expect(m.phaseGate).not.toHaveBeenCalled();
    expect(m.wwmd).not.toHaveBeenCalled();
  });

  it("plan without a branch after start_build: no write, skipped-wrong-phase", async () => {
    m.findUnique
      .mockResolvedValueOnce(BUILD)
      .mockResolvedValueOnce({ phase: "plan", buildBranch: null });
    const out = await dispatchBuildForApprovedPlan({ buildId: "FB-1", userId: "u1" });
    expect(out).toEqual({ kind: "skipped-wrong-phase", reason: "phase=plan after start_build" });
    expect(m.update).not.toHaveBeenCalled();
    expect(trace).toContain("activity:build_dispatch:Phase is plan after start_build — cannot advance, skipping orchestrator");
    expect(trace).not.toContain("orchestrator");
  });

  it("already in build after start_build (the usual case): no write, orchestrator runs", async () => {
    m.findUnique
      .mockResolvedValueOnce({ ...BUILD, phase: "build" })
      .mockResolvedValueOnce({ phase: "build", buildBranch: "build/FB-1" });
    const out = await dispatchBuildForApprovedPlan({ buildId: "FB-1", userId: "u1" });
    expect(out).toMatchObject({ kind: "dispatched-success" });
    expect(m.update).not.toHaveBeenCalled();
    expect(trace).not.toContain("gate:initiative-readiness");
    expect(trace).toContain("orchestrator");
  });

  it("initiative readiness refuses: no start_build, no write", async () => {
    m.findUnique.mockResolvedValueOnce(BUILD);
    m.initiative.mockResolvedValue({ allowed: false, message: "PLAN_COVERAGE_REQUIRED" });
    const out = await dispatchBuildForApprovedPlan({ buildId: "FB-1", userId: "u1" });
    expect(out).toMatchObject({ kind: "dispatched-failure", error: "PLAN_COVERAGE_REQUIRED" });
    expect(trace).toEqual([
      "read:featureBuild",
      "gate:initiative-readiness",
      "activity:build_dispatch:Skipped — PLAN_COVERAGE_REQUIRED",
    ]);
  });

  it("phase write throws: reported as dispatched-failure, orchestrator not run", async () => {
    m.findUnique
      .mockResolvedValueOnce(BUILD)
      .mockResolvedValueOnce({ phase: "plan", buildBranch: "build/FB-1" });
    m.update.mockRejectedValue(new Error("db down"));
    const out = await dispatchBuildForApprovedPlan({ buildId: "FB-1", userId: "u1" });
    expect(out).toMatchObject({ kind: "dispatched-failure", error: "db down" });
    expect(trace).toContain("activity:build_dispatch:Build dispatch failed: db down");
    expect(trace).not.toContain("orchestrator");
  });
});
