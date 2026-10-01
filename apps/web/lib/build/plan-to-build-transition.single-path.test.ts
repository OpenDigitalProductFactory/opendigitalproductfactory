// GPP Phase 2 PR-F (C-8, BI-45F9CB7A) — AC-SINGLE-TRANSITION.
//
// 1. The declared profiles are internally consistent (every path declares a mode
//    for every gate in PLAN_TO_BUILD_GATE_SET; evaluated gates are exactly the
//    gate steps; the WWMD mode matches the WWMD gate's mode).
// 2. transitionPlanToBuild runs a path's steps in the declared order, stops at
//    the first refusal, writes the phase once, and records the gate skip only for
//    `not-evaluated-recorded`.
// 3. Every plan→build entry point calls transitionPlanToBuild with its declared
//    path: all five are driven at runtime against a spy on the core module, and
//    every entry file is checked for exactly one call carrying its path literal.
// The per-path behaviour itself is pinned by the *.characterization.test.ts files.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  checkReadiness: vi.fn(),
  enforceReadiness: vi.fn(),
  transition: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
  activity: vi.fn(),
}));

vi.mock("@/lib/build/plan-to-build-transition-core", async (importActual) => {
  const actual = await importActual<typeof import("./plan-to-build-transition-core")>();
  return {
    ...actual,
    transitionPlanToBuild: (...a: unknown[]) => m.transition(...a),
    _actualTransitionPlanToBuild: actual.transitionPlanToBuild,
  };
});
vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findUnique: (...a: unknown[]) => m.findUnique(...a),
      update: (...a: unknown[]) => m.update(...a),
    },
    platformDevConfig: { findUnique: async () => ({ governedBacklogEnabled: true }) },
    buildActivity: { create: async () => ({}) },
    phaseHandoff: { create: async () => ({ id: "H1" }), update: async () => ({}), findMany: async () => [] },
    employeeProfile: { findFirst: async () => null },
    calendarEvent: { upsert: async () => ({}) },
    businessBuildBrief: { findUnique: async () => ({ status: "accepted" }) },
    user: { findUnique: async () => ({ isSuperuser: true, groups: [] }) },
  },
}));
vi.mock("@/lib/mcp/build-tool-helpers", () => ({
  resolveActiveBuildId: async () => "FB-1",
  extractBuildIdHint: () => undefined,
  logBuildActivity: (...a: unknown[]) => m.activity(...a),
}));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "user-1", platformRole: "HR-000", isSuperuser: true } }) }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: async () => ({ userId: "user-1" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContextForBuild: vi.fn() }));
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));
vi.mock("@/lib/build/build-entry-gate", () => ({
  enforceBuildInitiativeReadiness: (...a: unknown[]) => m.enforceReadiness(...a),
  assertBuildPhaseInitiativeReadiness: vi.fn(),
  checkBuildPhaseInitiativeReadiness: (...a: unknown[]) => m.checkReadiness(...a),
}));
vi.mock("@/lib/work-posture/verification-depth-gate", () => ({ checkBuildPhaseGate: async () => ({ allowed: true }) }));
vi.mock("@/lib/auth/ephemeral-ship-tokens", () => ({ manageEphemeralShipTokensForTransition: async () => undefined }));
vi.mock("@/lib/agent-event-bus", () => ({ agentEventBus: { emit: vi.fn() } }));
vi.mock("@/lib/build/build-execute-helpers", () => ({ isBuildDurableExecutionEnabled: () => true, buildExecuteSendId: () => "s" }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: async () => undefined } }));
vi.mock("@/lib/mcp-tools", () => ({ executeTool: async () => ({ success: true }) }));
vi.mock("@/lib/build/build-orchestrator", () => ({ runBuildOrchestrator: async () => ({ totalTasks: 1, completedTasks: 1 }) }));
vi.mock("@/lib/actions/external-evidence", () => ({ recordExternalEvidence: vi.fn() }));

import * as transitionModule from "./plan-to-build-transition-core";
import {
  PLAN_TO_BUILD_GATE_PROFILES,
  PLAN_TO_BUILD_GATE_SET,
  PLAN_TO_BUILD_GATE_SKIPPED_EVENT,
  PLAN_TO_BUILD_PASS,
  refusePlanToBuild,
  type PlanToBuildGateProfile,
  type PlanToBuildPath,
} from "./plan-to-build-transition";
import { advanceBuildPhase } from "@/lib/actions/build";
import { POST as advancePhaseRoute } from "@/app/api/agent/build/advance-phase/route";
import { buildEvidenceExtraPack } from "@/lib/mcp/packs/build-evidence-extra-pack";
import { dispatchBuildForApprovedPlan } from "./build-on-plan-approval";
import { performPlanToBuildTransition } from "./plan-to-build-transition";

const actualTransition = (transitionModule as unknown as {
  _actualTransitionPlanToBuild: typeof transitionModule.transitionPlanToBuild;
})._actualTransitionPlanToBuild;

const PATHS = Object.keys(PLAN_TO_BUILD_GATE_PROFILES) as PlanToBuildPath[];
const profiles = PLAN_TO_BUILD_GATE_PROFILES as Record<PlanToBuildPath, PlanToBuildGateProfile>;
const EVALUATED = new Set(["blocking", "blocking-soft", "autonomous-mode"]);

beforeEach(() => {
  vi.clearAllMocks();
  m.transition.mockResolvedValue({ kind: "advanced" });
  m.checkReadiness.mockResolvedValue(null);
  m.enforceReadiness.mockResolvedValue({ allowed: true, message: "allowed" });
  m.update.mockResolvedValue({});
});

describe("PLAN_TO_BUILD_GATE_PROFILES are consistent", () => {
  it("declares exactly the five plan→build paths", () => {
    expect(PATHS.sort()).toEqual([
      "advance-build-phase",
      "advance-phase-route",
      "build-on-plan-approval",
      "perform-plan-to-build-transition",
      "save-phase-handoff",
    ]);
  });

  it.each(PATHS)("%s: a mode for every declared gate; evaluated gates are exactly its gate steps", (path) => {
    const profile = profiles[path];
    expect(Object.keys(profile.gates).sort()).toEqual([...PLAN_TO_BUILD_GATE_SET].sort());
    const evaluated = PLAN_TO_BUILD_GATE_SET.filter((g) => EVALUATED.has(profile.gates[g]));
    const gateSteps = profile.steps.filter((s) => (PLAN_TO_BUILD_GATE_SET as readonly string[]).includes(s));
    expect([...gateSteps].sort()).toEqual([...evaluated].sort());
    expect(new Set(profile.steps).size).toBe(profile.steps.length);
  });

  it.each(PATHS)("%s: names the canonical readiness gate exactly when readiness is blocking", (path) => {
    const profile = profiles[path];
    expect(Boolean(profile.initiativeReadinessGate)).toBe(profile.gates["initiative-readiness"] === "blocking");
  });

  it.each(PATHS)("%s: the WWMD mode matches the WWMD gate, and only a recorded skip carries a summary", (path) => {
    const profile = profiles[path];
    expect(profile.gates["wwmd-plan-advancement"]).toBe(profile.wwmdMode);
    expect(Boolean(profile.gateSkippedSummary)).toBe(profile.wwmdMode === "not-evaluated-recorded");
  });

  it("save_phase_handoff still does not evaluate WWMD (enforcement awaits the C-8 decision)", () => {
    expect(profiles["save-phase-handoff"].wwmdMode).toBe("not-evaluated-recorded");
    expect(profiles["save-phase-handoff"].steps).toEqual(["structural-phase-gate"]);
  });
});

describe("transitionPlanToBuild", () => {
  it("runs steps in the declared order, not the object's key order, then writes once", async () => {
    const order: string[] = [];
    const step = (name: string) => () => { order.push(name); return PLAN_TO_BUILD_PASS; };
    const out = await actualTransition({
      buildId: "FB-1",
      path: "advance-phase-route",
      steps: { "wwmd-plan-advancement": step("wwmd"), "structural-phase-gate": step("structural") },
      beforeWrite: () => { order.push("beforeWrite"); },
    });
    expect(out).toEqual({ kind: "advanced" });
    expect(order).toEqual(["structural", "wwmd", "beforeWrite"]);
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenCalledWith({ where: { buildId: "FB-1" }, data: { phase: "build" } });
    expect(m.activity).not.toHaveBeenCalled();
  });

  it("calls the canonical readiness gate itself, with each path's exact arguments, first in order", async () => {
    const order: string[] = [];
    m.checkReadiness.mockImplementation(async () => { order.push("readiness"); return null; });
    const step = (name: string) => () => { order.push(name); return PLAN_TO_BUILD_PASS; };
    await actualTransition({
      buildId: "FB-1",
      path: "advance-build-phase",
      steps: {
        "wwmd-plan-advancement": step("wwmd"),
        "build-studio-decision-record": step("decision"),
        "dependency-gate": step("dependency"),
        "structural-phase-gate": step("structural"),
      },
    });
    expect(order).toEqual(["readiness", "structural", "dependency", "decision", "wwmd"]);
    expect(m.checkReadiness).toHaveBeenCalledWith({ buildId: "FB-1", currentPhase: "plan", targetPhase: "build" });
    expect(m.enforceReadiness).not.toHaveBeenCalled();

    m.checkReadiness.mockClear();
    const pass = () => PLAN_TO_BUILD_PASS;
    await actualTransition({
      buildId: "FB-2",
      path: "perform-plan-to-build-transition",
      steps: {
        "escalation-tracker": pass, "structural-phase-gate": pass, "dependency-gate": pass,
        "wwmd-plan-advancement": pass, "autonomous-eligibility": pass, "build-branch-init": pass,
      },
    });
    expect(m.enforceReadiness).toHaveBeenCalledWith({ buildId: "FB-2", target: "implementation", targetPhase: "build", expectedPhase: "plan" });
    expect(m.checkReadiness).not.toHaveBeenCalled();
  });

  it("a readiness refusal returns readiness-refused with its message, runs no later step and writes nothing", async () => {
    m.enforceReadiness.mockResolvedValue({ allowed: false, message: "PLAN_COVERAGE_REQUIRED" });
    const later = vi.fn(() => PLAN_TO_BUILD_PASS);
    const out = await actualTransition({
      buildId: "FB-1",
      path: "perform-plan-to-build-transition",
      steps: {
        "escalation-tracker": later, "structural-phase-gate": later, "dependency-gate": later,
        "wwmd-plan-advancement": later, "autonomous-eligibility": later, "build-branch-init": later,
      },
    });
    expect(out).toEqual({ kind: "readiness-refused", message: "PLAN_COVERAGE_REQUIRED" });
    expect(later).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("paths whose readiness is upstream or not evaluated never call a readiness gate", async () => {
    const pass = () => PLAN_TO_BUILD_PASS;
    await actualTransition({ buildId: "FB-1", path: "advance-phase-route", steps: { "structural-phase-gate": pass, "wwmd-plan-advancement": pass } });
    await actualTransition({ buildId: "FB-1", path: "save-phase-handoff", steps: { "structural-phase-gate": pass }, logActivity: () => {} });
    await actualTransition({ buildId: "FB-1", path: "build-on-plan-approval", steps: {} });
    expect(m.checkReadiness).not.toHaveBeenCalled();
    expect(m.enforceReadiness).not.toHaveBeenCalled();
  });

  it("stops at the first refusal and returns it, with no write", async () => {
    const later = vi.fn(() => PLAN_TO_BUILD_PASS);
    const out = await actualTransition<"advance-phase-route", string>({
      buildId: "FB-1",
      path: "advance-phase-route",
      steps: { "structural-phase-gate": () => refusePlanToBuild("no"), "wwmd-plan-advancement": later },
    });
    expect(out).toEqual({ kind: "refused", step: "structural-phase-gate", refusal: "no" });
    expect(later).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("propagates a step that throws, with no write", async () => {
    await expect(
      actualTransition({
        buildId: "FB-1",
        path: "advance-phase-route",
        steps: {
          "structural-phase-gate": () => PLAN_TO_BUILD_PASS,
          "wwmd-plan-advancement": () => { throw new Error("WWMD says no"); },
        },
      }),
    ).rejects.toThrow("WWMD says no");
    expect(m.update).not.toHaveBeenCalled();
  });

  it("records the gate skip after the write only for save_phase_handoff", async () => {
    await actualTransition({
      buildId: "FB-1",
      path: "save-phase-handoff",
      steps: { "structural-phase-gate": () => PLAN_TO_BUILD_PASS },
      logActivity: (...a: [string, string, string]) => m.activity(...a),
    });
    expect(m.activity.mock.calls).toEqual([
      ["FB-1", PLAN_TO_BUILD_GATE_SKIPPED_EVENT, profiles["save-phase-handoff"].gateSkippedSummary],
    ]);
    m.activity.mockClear();
    await actualTransition({ buildId: "FB-1", path: "build-on-plan-approval", steps: {} });
    expect(m.activity).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledTimes(2);
  });
});

describe("transitionPlanToBuild typing", () => {
  it("a not-evaluated-recorded path must hand in its activity logger, and only that path may", () => {
    const missing = () =>
      // @ts-expect-error -- logActivity is required where the WWMD skip is recorded
      actualTransition({ buildId: "x", path: "save-phase-handoff", steps: { "structural-phase-gate": () => PLAN_TO_BUILD_PASS } });
    const extra = () =>
      // @ts-expect-error -- a path that records nothing may not take a logger
      actualTransition({ buildId: "x", path: "build-on-plan-approval", steps: {}, logActivity: () => {} });
    expect([typeof missing, typeof extra]).toEqual(["function", "function"]);
  });
});

describe("AC-SINGLE-TRANSITION: every plan→build path calls transitionPlanToBuild", () => {
  function onlyCall() {
    expect(m.transition).toHaveBeenCalledTimes(1);
    return m.transition.mock.calls[0]![0] as { buildId: string; path: PlanToBuildPath; steps: Record<string, unknown> };
  }
  function expectStepsMatchProfile(call: { path: PlanToBuildPath; steps: Record<string, unknown> }) {
    // Initiative readiness is evaluated inside the transition, never supplied by the caller.
    expect(Object.keys(call.steps).sort()).toEqual(profiles[call.path].steps.filter((s) => s !== "initiative-readiness").sort());
  }

  const planBuild = {
    id: "row-1", buildId: "FB-1", title: "T", phase: "plan", kind: "feature", createdById: "user-1",
    originatingBacklogItemId: null, draftApprovedAt: null, designDoc: null, designReview: null,
    plan: {}, brief: {}, buildPlan: { tasks: [{ title: "t" }] }, planReview: null, taskResults: null,
    verificationOut: null, acceptanceMet: null, uxTestResults: null, uxVerificationStatus: null,
    sandboxId: null, deliberationSummary: null, parentEpicId: null, dependenciesOut: [], threadId: null,
  };

  it("advanceBuildPhase", async () => {
    m.findUnique.mockResolvedValue(planBuild);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(advanceBuildPhase("FB-1", "build")).resolves.toEqual({ ok: true });
    const call = onlyCall();
    expect(call).toMatchObject({ buildId: "FB-1", path: "advance-build-phase" });
    expectStepsMatchProfile(call);
    expect(m.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { phase: "build" } }));
  });

  it("POST /api/agent/build/advance-phase", async () => {
    m.findUnique.mockResolvedValue(planBuild);
    const res = await advancePhaseRoute({ json: async () => ({ buildId: "FB-1", targetPhase: "build" }) } as unknown as NextRequest);
    expect(res.status).toBe(200);
    const call = onlyCall();
    expect(call).toMatchObject({ buildId: "FB-1", path: "advance-phase-route" });
    expectStepsMatchProfile(call);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("save_phase_handoff auto-advance", async () => {
    m.findUnique.mockResolvedValue(planBuild);
    const res = await buildEvidenceExtraPack.handlers.save_phase_handoff!({ summary: "plan done" }, "user-1", { agentId: "AGT-ORCH-200", routeContext: "/build" } as never);
    expect(res).toEqual({ success: true, message: "Phase advanced: plan → build" });
    const call = onlyCall();
    expect(call).toMatchObject({ buildId: "FB-1", path: "save-phase-handoff" });
    expect(typeof (call as unknown as { logActivity?: unknown }).logActivity).toBe("function");
    expectStepsMatchProfile(call);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("dispatchBuildForApprovedPlan fallback write", async () => {
    m.findUnique
      .mockResolvedValueOnce({ phase: "plan", buildPlan: { tasks: [{ title: "t" }] }, taskResults: null, threadId: null, title: "T", kind: "feature" })
      .mockResolvedValueOnce({ phase: "plan", buildBranch: "build/FB-1" });
    await expect(dispatchBuildForApprovedPlan({ buildId: "FB-1", userId: "user-1" })).resolves.toMatchObject({ kind: "dispatched-success" });
    const call = onlyCall();
    expect(call).toEqual({ buildId: "FB-1", path: "build-on-plan-approval", steps: {} });
    expect(m.update).not.toHaveBeenCalled();
  });

  it("performPlanToBuildTransition (plan review, pre-build resume)", async () => {
    m.findUnique.mockResolvedValue({ ...planBuild, buildExecState: null });
    await expect(performPlanToBuildTransition({ buildId: "FB-1", userId: "user-1" })).resolves.toEqual({ kind: "advanced" });
    const call = onlyCall();
    expect(call).toMatchObject({ buildId: "FB-1", path: "perform-plan-to-build-transition" });
    expectStepsMatchProfile(call);
    expect(typeof (call as unknown as { beforeWrite?: unknown }).beforeWrite).toBe("function");
    expect(m.update).not.toHaveBeenCalled();
  });

  const ENTRY_FILES: Record<PlanToBuildPath, string> = {
    "advance-build-phase": "../actions/build.ts",
    "advance-phase-route": "../../app/api/agent/build/advance-phase/route.ts",
    "perform-plan-to-build-transition": "./plan-to-build-transition.ts",
    "save-phase-handoff": "../mcp/packs/build-evidence-extra-pack.ts",
    "build-on-plan-approval": "./build-on-plan-approval.ts",
  };

  it.each(PATHS)("%s: its entry file calls transitionPlanToBuild exactly once, with its path", (path) => {
    const source = readFileSync(resolve(__dirname, ENTRY_FILES[path]), "utf8");
    const calls = source.match(/transitionPlanToBuild(?:<[^>]*>)?\(\{[\s\S]*?path:\s*"([a-z-]+)"/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(`path: "${path}"`);
  });
});
