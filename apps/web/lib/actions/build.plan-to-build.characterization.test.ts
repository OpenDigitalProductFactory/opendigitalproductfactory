// GPP Phase 2 PR-F (C-8, BI-45F9CB7A) — characterization of the plan→build path
// through the `advanceBuildPhase` server action. Written against the tree BEFORE
// the shared-transition refactor and kept unchanged after it. It pins the gate
// order (Approve Start → initiative readiness → structural phase gate with the UX
// override → dependency gate → Build Studio decision record → blocking WWMD
// gate), each refusal's form (returned `{ ok: false }` or thrown), the single
// phase write, and the side effects after it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const trace = vi.hoisted(() => [] as string[]);
const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  devConfig: vi.fn(),
  activityCreate: vi.fn(),
  handoffCreate: vi.fn(),
  employee: vi.fn(),
  calendar: vi.fn(),
  initiative: vi.fn(),
  phaseGate: vi.fn(),
  dependency: vi.fn(),
  decision: vi.fn(),
  wwmd: vi.fn(),
  tokens: vi.fn(),
  emit: vi.fn(),
  jobsSend: vi.fn(),
}));

vi.mock("@/lib/actions/shared/guards", () => ({ requireCapability: async () => ({ userId: "user-1" }) }));
vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findUnique: (...a: unknown[]) => m.findUnique(...a),
      update: (...a: unknown[]) => {
        trace.push(`write:${JSON.stringify((a[0] as { data: unknown }).data)}`);
        return m.update(...a);
      },
    },
    platformDevConfig: { findUnique: (...a: unknown[]) => m.devConfig(...a) },
    buildActivity: {
      create: (...a: unknown[]) => {
        trace.push(`activity:${String((a[0] as { data: { tool: string } }).data.tool)}`);
        return m.activityCreate(...a);
      },
    },
    phaseHandoff: { create: (...a: unknown[]) => { trace.push("handoff:create"); return m.handoffCreate(...a); } },
    employeeProfile: { findFirst: (...a: unknown[]) => m.employee(...a) },
    calendarEvent: { upsert: (...a: unknown[]) => { trace.push("calendar"); return m.calendar(...a); } },
    businessBuildBrief: { findUnique: async () => ({ status: "accepted" }) },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContextForBuild: () => { trace.push("revalidate"); } }));
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));
vi.mock("@/lib/build/build-entry-gate", () => ({
  enforceBuildInitiativeReadiness: vi.fn(),
  assertBuildPhaseInitiativeReadiness: vi.fn(),
  checkBuildPhaseInitiativeReadiness: (...a: unknown[]) => { trace.push("gate:initiative-readiness"); return m.initiative(...a); },
}));
vi.mock("@/lib/build-flow-state", () => ({ completeBuildWhenDelivered: vi.fn() }));
vi.mock("@/lib/work-posture/verification-depth-gate", () => ({
  checkBuildPhaseGate: (...a: unknown[]) => { trace.push("gate:structural-phase-gate"); return m.phaseGate(...a); },
}));
vi.mock("@/lib/build/feature-build-dependencies", () => ({
  assertFeatureBuildDependencyGate: (...a: unknown[]) => { trace.push("gate:dependency-gate"); return m.dependency(...a); },
  FEATURE_BUILD_DEPENDENCY_GATE_SELECT: { dependenciesOut: true },
  recordReadyDependentsAfterCompletion: vi.fn(),
}));
vi.mock("@/lib/build/decision-service", () => ({
  evaluateBuildStudioDecision: (...a: unknown[]) => { trace.push("decision:build-studio"); return m.decision(...a); },
}));
vi.mock("@/lib/decision-perspective/build-studio-gate", () => ({
  evaluateBuildStudioPlanAdvancementGate: (...a: unknown[]) => { trace.push("gate:wwmd-plan-advancement"); return m.wwmd(...a); },
}));
vi.mock("@/lib/decision-perspective/planned-file-paths", () => ({ resolvePlannedFilePaths: async () => ["apps/web/x.ts"] }));
vi.mock("@/lib/build/build-studio-config", () => ({ isGraduatedGateAutonomyEnabled: () => false }));
vi.mock("@/lib/auth/ephemeral-ship-tokens", () => ({
  manageEphemeralShipTokensForTransition: (...a: unknown[]) => { trace.push("ship-tokens"); return m.tokens(...a); },
}));
vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { emit: (...a: unknown[]) => { trace.push("event:phase-change"); return m.emit(...a); } },
}));
vi.mock("@/lib/build/build-execute-helpers", () => ({
  isBuildDurableExecutionEnabled: () => true,
  buildExecuteSendId: () => "send-1",
}));
vi.mock("@/lib/jobs", () => ({ jobs: { send: (...a: unknown[]) => m.jobsSend(...a) } }));
vi.mock("@/lib/build-review-verification-trigger", () => ({ queueBuildReviewVerification: vi.fn() }));
vi.mock("@/lib/build/sandbox/sandbox", () => ({ listReleasableSandboxFiles: vi.fn() }));

import { advanceBuildPhase } from "./build";

function planBuild(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1", buildId: "FB-1", title: "Feature", phase: "plan", kind: "feature",
    createdById: "user-1", originatingBacklogItemId: "bi-row", draftApprovedAt: new Date("2026-09-01T00:00:00Z"),
    designDoc: { problemStatement: "p" }, designReview: { decision: "pass" },
    plan: { processSize: "medium" }, brief: { acceptanceCriteria: ["a"] },
    buildPlan: { tasks: [{ title: "t" }] }, planReview: { decision: "pass" },
    taskResults: null, verificationOut: null, acceptanceMet: null, uxTestResults: null, uxVerificationStatus: null,
    sandboxId: null, deliberationSummary: null, parentEpicId: null, dependenciesOut: [], threadId: "T1",
    ...overrides,
  };
}

const GATES = [
  "gate:initiative-readiness",
  "gate:structural-phase-gate",
  "gate:dependency-gate",
  "decision:build-studio",
  "activity:build-studio-decision",
  "gate:wwmd-plan-advancement",
];
const AFTER_WRITE = [
  'write:{"phase":"build"}',
  "revalidate",
  "ship-tokens",
  "event:phase-change",
  "handoff:create",
  "calendar",
  'write:{"calendarEventId":"BUILD-FB-1-build"}',
];

beforeEach(() => {
  trace.length = 0;
  vi.clearAllMocks();
  m.findUnique.mockResolvedValue(planBuild());
  m.update.mockResolvedValue({});
  m.devConfig.mockResolvedValue({ governedBacklogEnabled: true });
  m.activityCreate.mockResolvedValue({});
  m.handoffCreate.mockResolvedValue({});
  m.employee.mockResolvedValue({ id: "emp-1" });
  m.calendar.mockResolvedValue({});
  m.initiative.mockResolvedValue(null);
  m.phaseGate.mockResolvedValue({ allowed: true });
  m.dependency.mockReturnValue(undefined);
  m.decision.mockResolvedValue({ operatorActionLabel: "Start implementation", reasonSummary: "go" });
  m.wwmd.mockResolvedValue({ allowed: true, operatorMessage: "ok", evaluation: { outcomeType: "recommend" } });
  m.tokens.mockResolvedValue(undefined);
  m.jobsSend.mockResolvedValue(undefined);
});

describe("characterization: advanceBuildPhase plan→build", () => {
  it("passing build: gates in order, one phase write, then side effects and auto-execute", async () => {
    await expect(advanceBuildPhase("FB-1", "build")).resolves.toEqual({ ok: true });
    expect(trace).toEqual([...GATES, ...AFTER_WRITE]);
    expect(m.update).toHaveBeenCalledWith({ where: { buildId: "FB-1" }, data: { phase: "build" } });
    expect(m.update.mock.calls.filter((c) => JSON.stringify(c[0].data) === '{"phase":"build"}')).toHaveLength(1);
    expect(m.initiative).toHaveBeenCalledWith({ buildId: "FB-1", currentPhase: "plan", targetPhase: "build" });
    expect(m.activityCreate).toHaveBeenCalledWith({
      data: { buildId: "FB-1", tool: "build-studio-decision", summary: "Start implementation: go" },
    });
    expect(m.wwmd).toHaveBeenCalledWith({
      db: expect.anything(),
      build: { buildId: "FB-1", title: "Feature", phase: "plan", planReview: { decision: "pass" }, deliberationSummary: null },
      triggeredByUserId: "user-1",
      riskTier: undefined,
      plannedFilePaths: ["apps/web/x.ts"],
    });
    expect(m.handoffCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buildId: "FB-1", fromPhase: "plan", toPhase: "build",
        summary: "Phase plan complete. Advancing to build.",
        gateResult: { allowed: true, reason: "ok" },
      }),
    });
    expect(m.tokens).toHaveBeenCalledWith({ buildId: "FB-1", userId: "user-1", currentPhase: "plan", targetPhase: "build", buildTitle: "Feature" });
    await vi.waitFor(() => expect(m.jobsSend).toHaveBeenCalledWith(expect.objectContaining({ name: "build/execute.run", data: { buildId: "FB-1" } })));
  });

  it("Approve Start missing: returns before any gate", async () => {
    m.findUnique.mockResolvedValue(planBuild({ draftApprovedAt: null }));
    await expect(advanceBuildPhase("FB-1", "build")).resolves.toEqual({
      ok: false, message: "Approve Start before moving this backlog-linked draft into implementation.",
    });
    expect(trace).toEqual([]);
  });

  it("initiative readiness refuses: returns its message", async () => {
    m.initiative.mockResolvedValue("PLAN_COVERAGE_REQUIRED");
    await expect(advanceBuildPhase("FB-1", "build")).resolves.toEqual({ ok: false, message: "PLAN_COVERAGE_REQUIRED" });
    expect(trace).toEqual(["gate:initiative-readiness"]);
  });

  it("structural gate refuses: returns its reason", async () => {
    m.phaseGate.mockResolvedValue({ allowed: false, reason: "buildPlan-present required" });
    await expect(advanceBuildPhase("FB-1", "build")).resolves.toEqual({ ok: false, message: "buildPlan-present required" });
    expect(trace).toEqual(["gate:initiative-readiness", "gate:structural-phase-gate"]);
  });

  it("structural gate refuses on UX and an override is given: override recorded, transition continues", async () => {
    m.phaseGate.mockResolvedValue({ allowed: false, reason: "UX verification failed: 2 steps" });
    await expect(
      advanceBuildPhase("FB-1", "build", { overrideUxFailure: { reason: "operator verified manually" } }),
    ).resolves.toEqual({ ok: true });
    expect(trace.slice(0, 3)).toEqual(["gate:initiative-readiness", "gate:structural-phase-gate", "activity:ux-override"]);
    expect(trace).toContain('write:{"phase":"build"}');
    expect(m.handoffCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ gateResult: { allowed: false, reason: "UX verification failed: 2 steps" } }),
    });
  });

  it("dependency gate refuses: throws, no WWMD, no write", async () => {
    m.dependency.mockImplementation(() => { throw new Error("Waiting on: Sibling"); });
    await expect(advanceBuildPhase("FB-1", "build")).rejects.toThrow("Waiting on: Sibling");
    expect(trace).toEqual(["gate:initiative-readiness", "gate:structural-phase-gate", "gate:dependency-gate"]);
  });

  it("WWMD refuses: throws the operator message, no write", async () => {
    m.wwmd.mockResolvedValue({ allowed: false, operatorMessage: "WWMD requires escalation", evaluation: { outcomeType: "escalate" } });
    await expect(advanceBuildPhase("FB-1", "build")).rejects.toThrow("WWMD requires escalation");
    expect(trace).toEqual(GATES);
  });

  it("WWMD evaluator throws: the error propagates (no fail-open), no write", async () => {
    m.wwmd.mockRejectedValue(new Error("oracle down"));
    await expect(advanceBuildPhase("FB-1", "build")).rejects.toThrow("oracle down");
    expect(m.update).not.toHaveBeenCalled();
  });
});
