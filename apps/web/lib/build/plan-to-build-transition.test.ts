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
const admitPhaseTransitionMock = vi.fn();
const completeBuildPhaseRunMock = vi.fn();
const roomsMock = vi.fn();
const queryRawMock = vi.fn();
const kickMock = vi.fn();
const enforceInitiativeReadinessMock = vi.fn();

const ensureCoverageMock = vi.fn(async () => ({ recorded: false, reason: "already-covered" }));
vi.mock("@/lib/build/record-build-plan-coverage", () => ({
  ensureBuildPlanCoverage: (...a: unknown[]) => ensureCoverageMock(...(a as [])),
}));
const healShapeMock = vi.fn(async () => ({ healed: false, detail: "delivery shape already bound" }));
vi.mock("@/lib/build/heal-build-workroom-shape", () => ({
  healBuildWorkroomShape: (...a: unknown[]) => healShapeMock(...(a as [])),
}));

vi.mock("@dpf/db", () => {
  const prisma = {
    featureBuild: {
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      update: (...a: unknown[]) => updateMock(...a),
    },
    buildActivity: { create: (...a: unknown[]) => activityCreateMock(...a) },
    workroom: { findMany: (...a: unknown[]) => roomsMock(...a) },
    $queryRaw: (...a: unknown[]) => queryRawMock(...a),
    // A transaction that behaves like one: its writes reach the delegates only
    // when the callback resolves, so a throw inside it leaves nothing written
    // (BI-EB4BB4A0: the phase write and the owed dispatch commit together).
    $transaction: async (fn: (tx: unknown) => unknown) => {
      const pending: Array<() => unknown> = [];
      const tx = {
        featureBuild: {
          findUnique: (...a: unknown[]) => findUniqueMock(...a),
          update: (...a: unknown[]) => { pending.push(() => updateMock(...a)); return Promise.resolve({}); },
        },
        buildActivity: { create: (...a: unknown[]) => { pending.push(() => activityCreateMock(...a)); return Promise.resolve({}); } },
        $queryRaw: (...a: unknown[]) => queryRawMock(...a),
      };
      const result = await fn(tx);
      for (const write of pending) await write();
      return result;
    },
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
  admitPhaseTransition: (...a: unknown[]) => admitPhaseTransitionMock(...a),
  startBuildPhaseRun: (...a: unknown[]) => startBuildPhaseRunMock(...a),
  completeBuildPhaseRun: (...a: unknown[]) => completeBuildPhaseRunMock(...a),
}));
vi.mock("@/lib/workroom-runtime/effect-executors", () => ({
  kickWorkroomEffects: () => kickMock(),
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

  it("recordPlanAdvanceFailure keeps the tail of a long error, where a failed command puts its stderr", () => {
    // Live: three builds escalated with only the echoed `docker exec … sh -c '…` head
    // stored, so the escalation never said why the branch could not start.
    const command = `Command failed: docker exec 'dpf-sandbox-1' sh -c '${"x".repeat(400)}'`;
    const tracker = recordPlanAdvanceFailure(null, `startBuildBranch failed: ${command}\nfatal: could not lock ref`, new Date());
    expect(tracker.lastError!.length).toBeLessThanOrEqual(360);
    expect(tracker.lastError).toContain("startBuildBranch failed");
    expect(tracker.lastError).toContain("fatal: could not lock ref");
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
    admitPhaseTransitionMock.mockReset().mockResolvedValue(true);
    completeBuildPhaseRunMock.mockReset().mockResolvedValue(undefined);
    roomsMock.mockReset().mockResolvedValue([{ id: "room-row-1", capsuleId: "WC-ROOM1" }]);
    queryRawMock.mockReset().mockResolvedValue([{ id: "effect-1" }]);
    kickMock.mockReset();
    enforceInitiativeReadinessMock.mockReset().mockResolvedValue({ allowed: true, message: "allowed" });
  });

  it("blocks before branch mutation when canonical implementation readiness is not allowed", async () => {
    enforceInitiativeReadinessMock.mockResolvedValueOnce({ allowed: false, message: "PLAN_COVERAGE_REQUIRED" });

    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });

    expect(out).toEqual({ kind: "gate-blocked", reason: "PLAN_COVERAGE_REQUIRED" });
    expect(startBuildBranchMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalledWith(expect.objectContaining({ data: { phase: "build" } }));
  });

  // BI-F9EE05E5 slice B: during an upgrade drain the next phase waits. It
  // used to flip anyway while only the phase-run row was refused, so the
  // drain saw no open phase while the build worked.
  it("waits during an upgrade drain: no branch, no phase write, not counted as a failure", async () => {
    admitPhaseTransitionMock.mockResolvedValueOnce(false);
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "not-ready", reason: "waiting for the platform upgrade to finish" });
    expect(admitPhaseTransitionMock).toHaveBeenCalledWith("FB-X", "plan", "build");
    expect(startBuildBranchMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("advances a complete, reviewed, WWMD-recommended plan to build (initializes branch, flips phase, owes its dispatch)", async () => {
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "advanced" });
    expect(startBuildBranchMock).toHaveBeenCalledWith("FB-X");
    // phase flipped to build
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ data: { phase: "build" } }));
    // BI-EB4BB4A0: the dispatch is a committed Workroom effect, and the worker is kicked to run it.
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    expect(kickMock).toHaveBeenCalledTimes(1);
    expect(logBuildActivityMock).toHaveBeenCalledWith("FB-X", "phase:advance", expect.stringContaining("plan → build"));
  });

  // ── BI-EB4BB4A0: dispatch through the absorbed T3 core (Workroom outbox) ──
  /** The values bound into the one effect insert: [id, roomRowId, commandKey, ordinal, kind, processBound, generation, payload, ...]. */
  function effectInsert() {
    expect(queryRawMock).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRawMock.mock.calls[0]! as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).toContain('INSERT INTO "WorkroomEffect"');
    expect(strings.join("?")).toContain('ON CONFLICT ("workCapsuleId","commandKey","ordinal") DO NOTHING');
    return { roomRowId: values[1], commandKey: values[2], kind: values[4], processBound: values[5], payload: JSON.parse(String(values[7])) };
  }

  it("AC-1 single dispatch: commits one dispatch-build effect on the build's own room, keyed build-dispatch:<buildId>", async () => {
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toEqual({ kind: "advanced" });
    expect(effectInsert()).toEqual({
      roomRowId: "room-row-1",
      commandKey: "build-dispatch:FB-X",
      kind: "dispatch-build",
      processBound: false,
      payload: { buildId: "FB-X", userId: "u1" },
    });
    // The carrier is the build's own live Build Studio room, never another executor's.
    expect(roomsMock.mock.calls[0]![0]).toMatchObject({
      where: { executorKind: "build-studio", executorRef: "FB-X", featureBuildId: "row-1", archivedAt: null },
    });
    expect(logBuildActivityMock).toHaveBeenCalledWith("FB-X", "build_dispatch", "Build dispatch committed on Workroom WC-ROOM1.");
  });

  it("AC-1 single dispatch: a replayed transition reuses the same deterministic key, so the insert is a no-op", async () => {
    await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    const first = effectInsert().commandKey;
    queryRawMock.mockClear().mockResolvedValue([]); // ON CONFLICT DO NOTHING returns no row
    await performPlanToBuildTransition({ buildId: "FB-X", userId: "u2" });
    expect(effectInsert().commandKey).toBe(first);
  });

  it("AC-4 absence: with no Build Studio room to carry the dispatch, nothing moves and the failure is counted", async () => {
    roomsMock.mockResolvedValue([]);
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toMatchObject({ kind: "transition-failed", failures: 1, reason: expect.stringContaining("no single live Build Studio Workroom") });
    expect(startBuildBranchMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalledWith(expect.objectContaining({ data: { phase: "build" } }));
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(kickMock).not.toHaveBeenCalled();
  });

  it("AC-4 absence: two candidate rooms are ambiguous and are never guessed between", async () => {
    roomsMock.mockResolvedValue([{ id: "a", capsuleId: "WC-A" }, { id: "b", capsuleId: "WC-B" }]);
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out.kind).toBe("transition-failed");
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it("AC-4 failure: when the outbox write fails, the phase write rolls back with it and the failure is counted", async () => {
    queryRawMock.mockRejectedValue(new Error('type "WorkroomEffectKind" has no value dispatch-build'));
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out).toMatchObject({ kind: "transition-failed", failures: 1, reason: expect.stringContaining("plan → build commit failed") });
    expect(updateMock).not.toHaveBeenCalledWith(expect.objectContaining({ data: { phase: "build" } }));
    expect(kickMock).not.toHaveBeenCalled();
    expect(logBuildActivityMock).not.toHaveBeenCalledWith("FB-X", "phase:advance", expect.anything());
  });

  it("AC-4 failure: repeated commit failures escalate to the operator instead of looping", async () => {
    findUniqueMock.mockResolvedValue(planBuild({ buildExecState: { planAdvance: { failures: PLAN_ADVANCE_ESCALATE_AFTER - 1 } } }));
    queryRawMock.mockRejectedValue(new Error("outbox unavailable"));
    const out = await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(out.kind).toBe("escalated");
    expect(logBuildActivityMock).toHaveBeenCalledWith("FB-X", "phase:needs-operator", expect.stringContaining("outbox unavailable"));
  });

  it("a gate step that throws still propagates; it is not counted as a commit failure (independent review)", async () => {
    deriveDependencyGateMock.mockImplementation(() => { throw new Error("dependency read failed"); });
    await expect(performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" })).rejects.toThrow("dependency read failed");
    expect(updateMock).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ buildExecState: expect.anything() }),
    }));
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it("AC-6 retired path: the transition no longer runs the orchestrator itself", async () => {
    const orchestrator = await import("./build-on-plan-approval").catch(() => null);
    await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(orchestrator && "dispatchBuildForApprovedPlan" in orchestrator).toBe(false);
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

describe("plan coverage before the readiness gate (BI-6F2872FC)", () => {
  it("records the reviewed plan's coverage before judging the transition", async () => {
    ensureCoverageMock.mockClear();
    findUniqueMock.mockResolvedValueOnce(planBuild());
    await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(ensureCoverageMock).toHaveBeenCalledWith("FB-X");
  });

  it("does not cover a plan whose review did not pass, nor an escalated build", async () => {
    ensureCoverageMock.mockClear();
    findUniqueMock.mockResolvedValueOnce(planBuild({ planReview: { decision: "fail" } }));
    await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    findUniqueMock.mockResolvedValueOnce(planBuild({ buildExecState: { planAdvance: { failures: 3, escalatedAt: "2026-09-23T00:00:00Z" } } }));
    await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(ensureCoverageMock).not.toHaveBeenCalled();
  });

  // BI-9FA1F9CF: a decomposition child arrives here with no Workroom; judged
  // before its shape is bound, it is refused on receipts its shape does not owe.
  it("binds the delivery shape before recording coverage and judging readiness", async () => {
    healShapeMock.mockClear();
    ensureCoverageMock.mockClear();
    const order: string[] = [];
    healShapeMock.mockImplementationOnce(async () => { order.push("heal"); return { healed: true, detail: "attached" }; });
    ensureCoverageMock.mockImplementationOnce(async () => { order.push("coverage"); return { recorded: false, reason: "already-covered" }; });
    findUniqueMock.mockResolvedValueOnce(planBuild());
    await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(healShapeMock).toHaveBeenCalledWith({ buildId: "FB-X", userId: "u1" });
    expect(order).toEqual(["heal", "coverage"]);
  });

  it("still records coverage when the shape heal throws", async () => {
    ensureCoverageMock.mockClear();
    healShapeMock.mockRejectedValueOnce(new Error("db down"));
    findUniqueMock.mockResolvedValueOnce(planBuild());
    await performPlanToBuildTransition({ buildId: "FB-X", userId: "u1" });
    expect(ensureCoverageMock).toHaveBeenCalledWith("FB-X");
  });
});
