// GPP Phase 2 PR-F (C-8, BI-45F9CB7A) — characterization of the plan→build path
// `performPlanToBuildTransition` (used by reviewBuildPlan and the pre-build
// resume reconciler). Written against the tree BEFORE the shared-transition
// refactor and kept unchanged after it: it pins which gates run, in what order,
// under which autonomous-playbook mode, and what is written and logged. Any edit
// to an expectation here is a behaviour change, not a refactor.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trace = vi.hoisted(() => [] as string[]);
const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  activityCreate: vi.fn(),
  initiative: vi.fn(),
  phaseGate: vi.fn(),
  dependency: vi.fn(),
  wwmd: vi.fn(),
  eligibility: vi.fn(),
  sandbox: vi.fn(),
  branch: vi.fn(),
  activity: vi.fn(),
  emit: vi.fn(),
  handoffSummary: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock("@dpf/db", () => {
  const prisma = {
    featureBuild: {
      findUnique: (...a: unknown[]) => m.findUnique(...a),
      update: (...a: unknown[]) => {
        trace.push(`write:${JSON.stringify((a[0] as { data: unknown }).data)}`);
        return m.update(...a);
      },
    },
    buildActivity: { create: (...a: unknown[]) => m.activityCreate(...a) },
    $transaction: (fn: (tx: unknown) => unknown) => fn(prisma),
  };
  return { prisma };
});
vi.mock("@/lib/build/build-entry-gate", () => ({
  enforceBuildInitiativeReadiness: (...a: unknown[]) => { trace.push("gate:initiative-readiness"); return m.initiative(...a); },
}));
vi.mock("@/lib/work-posture/verification-depth-gate", () => ({
  checkBuildPhaseGate: (...a: unknown[]) => { trace.push("gate:structural-phase-gate"); return m.phaseGate(...a); },
}));
vi.mock("@/lib/build/feature-build-dependencies", () => ({
  deriveFeatureBuildDependencyGate: (...a: unknown[]) => { trace.push("gate:dependency-gate"); return m.dependency(...a); },
  FEATURE_BUILD_DEPENDENCY_GATE_SELECT: { dependenciesOut: true },
}));
vi.mock("@/lib/decision-perspective/build-studio-gate", () => ({
  evaluateBuildStudioPlanAdvancementGate: (...a: unknown[]) => { trace.push("gate:wwmd-plan-advancement"); return m.wwmd(...a); },
}));
vi.mock("@/lib/decision-perspective/planned-file-paths", () => ({ resolvePlannedFilePaths: async () => [] }));
vi.mock("@/lib/build/autonomous-build-phase-runtime", () => ({
  resolveAutonomousBuildPhaseEligibility: (...a: unknown[]) => { trace.push("gate:autonomous-eligibility"); return m.eligibility(...a); },
}));
vi.mock("@/lib/build/sandbox/build-branch", () => ({
  isSandboxAvailable: (...a: unknown[]) => { trace.push("sandbox-available?"); return m.sandbox(...a); },
  startBuildBranch: (...a: unknown[]) => { trace.push("start-build-branch"); return m.branch(...a); },
}));
vi.mock("@/lib/build/build-phase-run", () => ({
  completeBuildPhaseRun: () => { trace.push("phase-run:complete-plan"); return Promise.resolve(); },
  startBuildPhaseRun: () => { trace.push("phase-run:start-build"); return Promise.resolve(); },
}));
vi.mock("@/lib/build/phase-compaction-wire", () => ({
  persistPhaseHandoffSummary: (...a: unknown[]) => { trace.push("handoff-summary"); return m.handoffSummary(...a); },
}));
vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { emit: (...a: unknown[]) => { trace.push("event:phase-change"); return m.emit(...a); } },
}));
vi.mock("@/lib/mcp/build-tool-helpers", () => ({
  logBuildActivity: (...a: unknown[]) => { trace.push(`activity:${String(a[1])}`); return m.activity(...a); },
}));
vi.mock("@/lib/build/build-on-plan-approval", () => ({
  dispatchBuildForApprovedPlan: (...a: unknown[]) => m.dispatch(...a),
}));

import { performPlanToBuildTransition } from "./plan-to-build-transition";

function planBuild(overrides: Record<string, unknown> = {}) {
  return {
    phase: "plan",
    plan: { processSize: "medium" },
    buildPlan: { tasks: [{ title: "t" }] },
    planReview: { decision: "pass" },
    id: "row-1",
    buildId: "FB-X",
    title: "A feature",
    kind: "feature",
    parentEpicId: null,
    deliberationSummary: null,
    buildExecState: null,
    dependenciesOut: [],
    ...overrides,
  };
}

const ADVANCED_TRACE = [
  "gate:initiative-readiness",
  "gate:structural-phase-gate",
  "gate:dependency-gate",
  "gate:wwmd-plan-advancement",
];
const BRANCH_AND_WRITE = [
  "sandbox-available?",
  "start-build-branch",
  "phase-run:complete-plan",
  "phase-run:start-build",
  'write:{"phase":"build"}',
  "activity:phase:advance",
];

function activities() {
  return m.activity.mock.calls.map((c) => [c[0], c[1], c[2]]);
}
function phaseWrites() {
  return m.update.mock.calls.filter((c) => JSON.stringify((c[0] as { data: unknown }).data) === '{"phase":"build"}');
}

beforeEach(() => {
  trace.length = 0;
  vi.clearAllMocks();
  vi.stubEnv("DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE", "");
  m.findUnique.mockResolvedValue(planBuild());
  m.update.mockResolvedValue({});
  m.activityCreate.mockResolvedValue({});
  m.initiative.mockResolvedValue({ allowed: true, message: "allowed" });
  m.phaseGate.mockResolvedValue({ allowed: true });
  m.dependency.mockReturnValue({ allowed: true });
  m.wwmd.mockResolvedValue({ allowed: true, operatorMessage: "ok", evaluation: { outcomeType: "recommend" } });
  m.eligibility.mockResolvedValue({ mayAct: true, executionProfileRef: null, eligibility: { blockers: [] } });
  m.sandbox.mockResolvedValue(true);
  m.branch.mockResolvedValue(undefined);
  m.dispatch.mockResolvedValue({ kind: "dispatched-success" });
});
afterEach(() => vi.unstubAllEnvs());

describe("characterization: performPlanToBuildTransition (autonomous playbook off)", () => {
  it("passing build: gates in order, branch before write, one phase write, one phase:advance entry", async () => {
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "advanced" });
    expect(trace).toEqual([...ADVANCED_TRACE, ...BRANCH_AND_WRITE]);
    expect(m.update).toHaveBeenCalledWith({ where: { buildId: "FB-X" }, data: { phase: "build" } });
    expect(phaseWrites()).toHaveLength(1);
    expect(activities()).toEqual([["FB-X", "phase:advance", "Phase advanced: plan → build (buildBranch initialized)"]]);
    expect(m.initiative).toHaveBeenCalledWith({ buildId: "FB-X", target: "implementation", targetPhase: "build", expectedPhase: "plan" });
    expect(m.wwmd.mock.calls[0]![0]).not.toHaveProperty("riskTier");
    await vi.waitFor(() => expect(m.dispatch).toHaveBeenCalledWith({ buildId: "FB-X", userId: "u1" }));
  });

  it("with a thread: handoff summary before the write, phase-change event after it", async () => {
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1", context: { threadId: "T1" } });
    expect(out).toEqual({ kind: "advanced" });
    expect(trace).toEqual([
      ...ADVANCED_TRACE,
      "sandbox-available?",
      "start-build-branch",
      "phase-run:complete-plan",
      "phase-run:start-build",
      "handoff-summary",
      'write:{"phase":"build"}',
      "event:phase-change",
      "activity:phase:advance",
    ]);
    expect(m.emit).toHaveBeenCalledWith("T1", { type: "phase:change", buildId: "FB-X", phase: "build" });
  });

  it("not in plan: not-ready before any gate", async () => {
    m.findUnique.mockResolvedValue(planBuild({ phase: "build" }));
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "not-ready", reason: "build is in phase build, not plan" });
    expect(trace).toEqual([]);
  });

  it("initiative readiness refuses: gate-blocked, nothing after it", async () => {
    m.initiative.mockResolvedValue({ allowed: false, message: "PLAN_COVERAGE_REQUIRED" });
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "gate-blocked", reason: "PLAN_COVERAGE_REQUIRED" });
    expect(trace).toEqual(["gate:initiative-readiness", "activity:phase:gate-blocked"]);
    expect(activities()).toEqual([["FB-X", "phase:gate-blocked", "PLAN_COVERAGE_REQUIRED"]]);
  });

  it("already escalated: escalated after initiative readiness, before the structural gate", async () => {
    m.findUnique.mockResolvedValue(planBuild({ buildExecState: { planAdvance: { failures: 4, lastError: "e", escalatedAt: "2026-07-22T00:00:00Z" } } }));
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "escalated", reason: "e", failures: 4 });
    expect(trace).toEqual(["gate:initiative-readiness"]);
  });

  it("structural gate refuses: gate-blocked with its reason", async () => {
    m.phaseGate.mockResolvedValue({ allowed: false, reason: "buildPlan-present required" });
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "gate-blocked", reason: "buildPlan-present required" });
    expect(trace).toEqual(["gate:initiative-readiness", "gate:structural-phase-gate", "activity:phase:gate-blocked"]);
  });

  it("dependency waiting: gate-blocked with the dependency message", async () => {
    m.dependency.mockReturnValue({ allowed: false, blocked: "waiting", message: "Waiting on: Sibling" });
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "gate-blocked", reason: "Waiting on: Sibling" });
    expect(trace).toEqual([...ADVANCED_TRACE.slice(0, 3), "activity:phase:gate-blocked"]);
  });

  it("dependency unsatisfiable: abandons, no wwmd, no build write", async () => {
    m.findUnique
      .mockResolvedValueOnce(planBuild({ parentEpicId: "epic-1" }))
      .mockResolvedValueOnce({ phase: "plan", abandonedAt: null });
    m.dependency.mockReturnValue({
      allowed: false,
      blocked: "unsatisfiable",
      deadDependencies: [{ buildId: "FB-DEAD" }],
      message: "Blocked permanently",
    });
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "dependency-unsatisfiable", reason: "Blocked permanently", deadDependencyBuildIds: ["FB-DEAD"] });
    expect(trace.slice(0, 3)).toEqual(ADVANCED_TRACE.slice(0, 3));
    expect(trace).not.toContain("gate:wwmd-plan-advancement");
    expect(phaseWrites()).toHaveLength(0);
  });

  it("WWMD refuses: wwmd-withheld, wwmd:gate-blocked entry, no branch, no write", async () => {
    m.wwmd.mockResolvedValue({ allowed: false, operatorMessage: "principle conflict", evaluation: { outcomeType: "escalate" } });
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "wwmd-withheld", reason: "principle conflict" });
    expect(trace).toEqual([...ADVANCED_TRACE, "activity:wwmd:gate-blocked"]);
    expect(activities()).toEqual([["FB-X", "wwmd:gate-blocked", "principle conflict"]]);
  });

  it("WWMD evaluator throws: fails open and advances", async () => {
    m.wwmd.mockRejectedValue(new Error("oracle down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "advanced" });
    expect(trace).toEqual([...ADVANCED_TRACE, ...BRANCH_AND_WRITE]);
  });

  it("sandbox down: transition-failed, tracker persisted, no phase write", async () => {
    m.sandbox.mockResolvedValue(false);
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "transition-failed", reason: "sandbox not running", failures: 1 });
    expect(phaseWrites()).toHaveLength(0);
    expect(activities()).toEqual([["FB-X", "phase:gate-blocked", "plan → build transition failed (attempt 1): sandbox not running"]]);
  });
});

describe("characterization: performPlanToBuildTransition (autonomous playbook shadow)", () => {
  beforeEach(() => vi.stubEnv("DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE", "shadow"));

  it("WWMD refuses: logs autonomous_playbook_shadow and still advances", async () => {
    m.wwmd.mockResolvedValue({ allowed: false, operatorMessage: "would withhold", evaluation: { outcomeType: "defer" } });
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "advanced" });
    expect(trace).toEqual([
      ...ADVANCED_TRACE,
      "activity:autonomous_playbook_shadow",
      "gate:autonomous-eligibility",
      ...BRANCH_AND_WRITE,
    ]);
    expect(activities()[0]).toEqual(["FB-X", "autonomous_playbook_shadow", "Shadow plan gate would withhold advancement: would withhold."]);
    expect(m.wwmd.mock.calls[0]![0]).toHaveProperty("riskTier");
    expect(m.eligibility).toHaveBeenCalledWith({ buildId: "FB-X", checkpoint: "plan", gateOutcome: "defer" });
  });

  it("eligibility not cleared: shadow does not park", async () => {
    m.eligibility.mockResolvedValue({ mayAct: false, executionProfileRef: null, eligibility: { blockers: ["x"] } });
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "advanced" });
  });
});

describe("characterization: performPlanToBuildTransition (autonomous playbook enforce)", () => {
  beforeEach(() => vi.stubEnv("DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE", "enforce"));

  it("passing build: eligibility consulted after WWMD, then advances", async () => {
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "advanced" });
    expect(trace).toEqual([...ADVANCED_TRACE, "gate:autonomous-eligibility", ...BRANCH_AND_WRITE]);
  });

  it("WWMD refuses: withheld", async () => {
    m.wwmd.mockResolvedValue({ allowed: false, operatorMessage: "no", evaluation: { outcomeType: "escalate" } });
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "wwmd-withheld", reason: "no" });
    expect(trace).toEqual([...ADVANCED_TRACE, "activity:wwmd:gate-blocked"]);
  });

  it("WWMD evaluator throws: fails closed with autonomous:needs-decision", async () => {
    m.wwmd.mockRejectedValue(new Error("oracle down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "wwmd-withheld", reason: "autonomous decision oracle unavailable" });
    expect(trace).toEqual([...ADVANCED_TRACE, "activity:autonomous:needs-decision"]);
  });

  it("eligibility not cleared: parks with the blockers", async () => {
    m.eligibility.mockResolvedValue({ mayAct: false, executionProfileRef: null, eligibility: { blockers: ["needs evidence"] } });
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "wwmd-withheld", reason: "needs evidence" });
    expect(trace).toEqual([...ADVANCED_TRACE, "gate:autonomous-eligibility", "activity:autonomous:needs-decision"]);
    expect(activities()).toEqual([["FB-X", "autonomous:needs-decision", "Plan advancement parked: needs evidence."]]);
  });

  it("eligibility throws: parks", async () => {
    m.eligibility.mockRejectedValue(new Error("boom"));
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "wwmd-withheld", reason: "autonomous eligibility unavailable: boom" });
    expect(phaseWrites()).toHaveLength(0);
  });
});
