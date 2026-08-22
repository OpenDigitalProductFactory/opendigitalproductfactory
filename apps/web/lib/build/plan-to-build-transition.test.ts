import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Collaborator mocks ───────────────────────────────────────────────────────
const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const activityCreateMock = vi.fn();
const checkPhaseGateMock = vi.fn();
const canTransitionPhaseMock = vi.fn();
const normalizeHappyPathStateMock = vi.fn();
const deriveDependencyGateMock = vi.fn();
const logBuildActivityMock = vi.fn();
const evaluateWwmdGateMock = vi.fn();
const isSandboxAvailableMock = vi.fn();
const startBuildBranchMock = vi.fn();
const startBuildPhaseRunMock = vi.fn();
const completeBuildPhaseRunMock = vi.fn();
const dispatchBuildMock = vi.fn();
const enforceInitiativeReadinessMock = vi.fn();

vi.mock("@dpf/db", () => {
  const prisma = {
    featureBuild: {
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      update: (...a: unknown[]) => updateMock(...a),
    },
    buildActivity: { create: (...a: unknown[]) => activityCreateMock(...a) },
    // abandonDeadlockedDependent runs its re-check + write in a $transaction;
    // invoke the callback immediately with the same mocked delegates.
    $transaction: (fn: (tx: unknown) => unknown) => fn(prisma),
  };
  return { prisma };
});
vi.mock("@/lib/feature-build-types", () => ({
  checkPhaseGate: (...a: unknown[]) => checkPhaseGateMock(...a),
  canTransitionPhase: (...a: unknown[]) => canTransitionPhaseMock(...a),
  normalizeHappyPathState: (...a: unknown[]) => normalizeHappyPathStateMock(...a),
}));
vi.mock("@/lib/build/feature-build-dependencies", () => ({
  deriveFeatureBuildDependencyGate: (...a: unknown[]) => deriveDependencyGateMock(...a),
  FEATURE_BUILD_DEPENDENCY_GATE_SELECT: { dependenciesOut: true },
}));
vi.mock("@/lib/mcp/build-tool-helpers", () => ({
  logBuildActivity: (...a: unknown[]) => logBuildActivityMock(...a),
}));
vi.mock("@/lib/decision-perspective/build-studio-gate", () => ({
  evaluateBuildStudioPlanAdvancementGate: (...a: unknown[]) => evaluateWwmdGateMock(...a),
}));
vi.mock("@/lib/build/sandbox/build-branch", () => ({
  isSandboxAvailable: (...a: unknown[]) => isSandboxAvailableMock(...a),
  startBuildBranch: (...a: unknown[]) => startBuildBranchMock(...a),
}));
vi.mock("@/lib/build/build-phase-run", () => ({
  startBuildPhaseRun: (...a: unknown[]) => startBuildPhaseRunMock(...a),
  completeBuildPhaseRun: (...a: unknown[]) => completeBuildPhaseRunMock(...a),
}));
vi.mock("@/lib/build/build-on-plan-approval", () => ({
  dispatchBuildForApprovedPlan: (...a: unknown[]) => dispatchBuildMock(...a),
}));
vi.mock("@/lib/build/build-entry-gate", () => ({
  enforceBuildInitiativeReadiness: (...a: unknown[]) => enforceInitiativeReadinessMock(...a),
}));

import {
  performPlanToBuildTransition,
  recordPlanAdvanceFailure,
  shouldEscalatePlanAdvance,
  readPlanAdvanceTracker,
  PLAN_ADVANCE_ESCALATE_AFTER,
} from "./plan-to-build-transition";

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

describe("plan-advance pure helpers (BI-05208DE5)", () => {
  it("recordPlanAdvanceFailure increments the counter and stamps the latest error", () => {
    const now = new Date("2026-07-22T00:00:00Z");
    const first = recordPlanAdvanceFailure(null, "boom", now);
    expect(first.failures).toBe(1);
    expect(first.lastError).toBe("boom");
    expect(first.lastAt).toBe(now.toISOString());
    const second = recordPlanAdvanceFailure(first, "boom again", now);
    expect(second.failures).toBe(2);
    expect(second.lastError).toBe("boom again");
  });

  it("recordPlanAdvanceFailure preserves a prior escalatedAt stamp", () => {
    const now = new Date("2026-07-22T00:00:00Z");
    const prev = { failures: 3, escalatedAt: "2026-07-21T00:00:00Z" };
    expect(recordPlanAdvanceFailure(prev, "x", now).escalatedAt).toBe("2026-07-21T00:00:00Z");
  });

  it("shouldEscalatePlanAdvance fires only at/above the threshold", () => {
    expect(shouldEscalatePlanAdvance({ failures: PLAN_ADVANCE_ESCALATE_AFTER - 1 })).toBe(false);
    expect(shouldEscalatePlanAdvance({ failures: PLAN_ADVANCE_ESCALATE_AFTER })).toBe(true);
    expect(shouldEscalatePlanAdvance({ failures: 1, threshold: 1 })).toBe(true);
  });

  it("readPlanAdvanceTracker parses a persisted tracker and defends against junk", () => {
    expect(readPlanAdvanceTracker(null)).toBeNull();
    expect(readPlanAdvanceTracker({ planAdvance: "nope" })).toBeNull();
    expect(readPlanAdvanceTracker({ planAdvance: { failures: 2, lastError: "e" } })).toMatchObject({
      failures: 2,
      lastError: "e",
    });
  });
});

describe("performPlanToBuildTransition (BI-05208DE5)", () => {
  beforeEach(() => {
    findUniqueMock.mockReset().mockResolvedValue(planBuild());
    updateMock.mockReset().mockResolvedValue({});
    activityCreateMock.mockReset().mockResolvedValue({});
    checkPhaseGateMock.mockReset().mockReturnValue({ allowed: true });
    canTransitionPhaseMock.mockReset().mockReturnValue(true);
    normalizeHappyPathStateMock.mockReset().mockReturnValue({});
    deriveDependencyGateMock.mockReset().mockReturnValue({ allowed: true });
    logBuildActivityMock.mockReset();
    evaluateWwmdGateMock.mockReset().mockResolvedValue({ allowed: true, operatorMessage: "ok" });
    isSandboxAvailableMock.mockReset().mockResolvedValue(true);
    startBuildBranchMock.mockReset().mockResolvedValue(null);
    startBuildPhaseRunMock.mockReset().mockResolvedValue(undefined);
    completeBuildPhaseRunMock.mockReset().mockResolvedValue(undefined);
    dispatchBuildMock.mockReset().mockResolvedValue({ kind: "dispatched" });
    enforceInitiativeReadinessMock.mockReset().mockResolvedValue({ allowed: true, message: "allowed" });
  });

  it("blocks before branch mutation when canonical implementation readiness is not allowed", async () => {
    enforceInitiativeReadinessMock.mockResolvedValueOnce({ allowed: false, message: "PLAN_COVERAGE_REQUIRED" });

    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });

    expect(out).toEqual({ kind: "gate-blocked", reason: "PLAN_COVERAGE_REQUIRED" });
    expect(startBuildBranchMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalledWith(expect.objectContaining({ data: { phase: "build" } }));
  });

  it("advances a complete, reviewed, WWMD-recommended plan to build (initializes branch, flips phase, dispatches)", async () => {
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "advanced" });
    expect(startBuildBranchMock).toHaveBeenCalledWith("FB-X");
    // phase flipped to build
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ data: { phase: "build" } }));
    // build orchestrator auto-dispatched (fire-and-forget dynamic import — flush)
    await vi.waitFor(() => expect(dispatchBuildMock).toHaveBeenCalledWith({ buildId: "FB-X", userId: "u1" }));
    expect(logBuildActivityMock).toHaveBeenCalledWith("FB-X", "phase:advance", expect.stringContaining("plan → build"));
  });

  it("does NOT flip when the WWMD gate withholds advancement", async () => {
    evaluateWwmdGateMock.mockResolvedValue({ allowed: false, operatorMessage: "principle conflict" });
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out.kind).toBe("wwmd-withheld");
    expect(startBuildBranchMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalledWith(expect.objectContaining({ data: { phase: "build" } }));
  });

  it("counts a startBuildBranch failure and returns transition-failed below the threshold (does not flip)", async () => {
    startBuildBranchMock.mockRejectedValue(new Error("Command failed: docker exec ..."));
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toMatchObject({ kind: "transition-failed", failures: 1 });
    // never flips to build
    expect(updateMock).not.toHaveBeenCalledWith(expect.objectContaining({ data: { phase: "build" } }));
    // persists the tracker
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buildExecState: expect.objectContaining({ planAdvance: expect.objectContaining({ failures: 1 }) }),
        }),
      }),
    );
  });

  it("escalates to the operator after the threshold and pauses the loop", async () => {
    // Prior tracker already at threshold-1 failures.
    findUniqueMock.mockResolvedValue(
      planBuild({ parentEpicId: "cmr-epic", buildExecState: { planAdvance: { failures: PLAN_ADVANCE_ESCALATE_AFTER - 1 } } }),
    );
    startBuildBranchMock.mockRejectedValue(new Error("Command failed: docker exec ..."));
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out.kind).toBe("escalated");
    expect((out as { failures: number }).failures).toBe(PLAN_ADVANCE_ESCALATE_AFTER);
    expect(logBuildActivityMock).toHaveBeenCalledWith("FB-X", "phase:needs-operator", expect.stringContaining("epic-child"));
  });

  it("short-circuits to escalated (skips the failing transition) once already escalated", async () => {
    findUniqueMock.mockResolvedValue(
      planBuild({ buildExecState: { planAdvance: { failures: 5, escalatedAt: "2026-07-22T00:00:00Z" } } }),
    );
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out.kind).toBe("escalated");
    // No transition work at all — the whole point of pausing the flood.
    expect(startBuildBranchMock).not.toHaveBeenCalled();
    expect(evaluateWwmdGateMock).not.toHaveBeenCalled();
  });

  it("returns not-ready when the build is no longer in the plan phase", async () => {
    findUniqueMock.mockResolvedValue(planBuild({ phase: "build" }));
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out.kind).toBe("not-ready");
    expect(startBuildBranchMock).not.toHaveBeenCalled();
  });

  it("blocks on the structural phase gate without attempting the branch", async () => {
    checkPhaseGateMock.mockReturnValue({ allowed: false, reason: "buildPlan-present required" });
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toMatchObject({ kind: "gate-blocked" });
    expect(startBuildBranchMock).not.toHaveBeenCalled();
  });

  it("treats sandbox-not-running as a counted transition failure", async () => {
    isSandboxAvailableMock.mockResolvedValue(false);
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toMatchObject({ kind: "transition-failed", failures: 1 });
    expect(startBuildBranchMock).not.toHaveBeenCalled();
  });

  // BI-7B6D7661: an unsatisfiable dependency (a dead sibling) must terminally
  // abandon the dependent, not loop as gate-blocked forever.
  it("abandons the build (not gate-blocked) when a dependency is unsatisfiable", async () => {
    findUniqueMock
      // 1st read: the transition's own build fetch (still in plan).
      .mockResolvedValueOnce(planBuild({ parentEpicId: "epic-1" }))
      // 2nd read: the re-check inside abandonDeadlockedDependent's transaction.
      .mockResolvedValueOnce({ phase: "plan", abandonedAt: null });
    deriveDependencyGateMock.mockReturnValue({
      allowed: false,
      blocked: "unsatisfiable",
      waitingOn: [{ buildId: "FB-DEAD", title: "Dead sibling", phase: "abandoned" }],
      deadDependencies: [{ buildId: "FB-DEAD", title: "Dead sibling", phase: "abandoned" }],
      message: "Blocked permanently: sibling build(s) Dead sibling were abandoned/failed …",
    });

    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });

    expect(out).toMatchObject({ kind: "dependency-unsatisfiable", deadDependencyBuildIds: ["FB-DEAD"] });
    // Terminally abandoned — NOT flipped to build, NOT left in plan.
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phase: "abandoned" }) }),
    );
    expect(updateMock).not.toHaveBeenCalledWith(expect.objectContaining({ data: { phase: "build" } }));
    expect(startBuildBranchMock).not.toHaveBeenCalled();
    // WWMD gate never runs — we bailed at the dependency gate.
    expect(evaluateWwmdGateMock).not.toHaveBeenCalled();
  });

  it("does not abandon a build that advanced out of plan between the gate read and the write", async () => {
    findUniqueMock
      .mockResolvedValueOnce(planBuild({ parentEpicId: "epic-1" }))
      // Re-check finds it already moved on — leave it untouched.
      .mockResolvedValueOnce({ phase: "build", abandonedAt: null });
    deriveDependencyGateMock.mockReturnValue({
      allowed: false,
      blocked: "unsatisfiable",
      waitingOn: [{ buildId: "FB-DEAD", title: "Dead sibling", phase: "failed" }],
      deadDependencies: [{ buildId: "FB-DEAD", title: "Dead sibling", phase: "failed" }],
      message: "Blocked permanently …",
    });

    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });

    expect(out.kind).toBe("dependency-unsatisfiable");
    // Re-check guard held: no abandon write.
    expect(updateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phase: "abandoned" }) }),
    );
  });
});
