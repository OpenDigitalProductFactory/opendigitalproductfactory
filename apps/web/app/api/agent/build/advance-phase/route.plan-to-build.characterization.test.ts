// GPP Phase 2 PR-F (C-8, BI-45F9CB7A) — characterization of the plan→build path
// through POST /api/agent/build/advance-phase. Written against the tree BEFORE
// the shared-transition refactor and kept unchanged after it. It pins: Approve
// Start and the transition check first, then the structural phase gate and the
// blocking WWMD gate (no initiative readiness, no dependency gate), each refusal
// as HTTP 422 with its current body, one phase write, then the event and the
// "phase:advance" activity entry.
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const trace = vi.hoisted(() => [] as string[]);
const m = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  devConfig: vi.fn(),
  activityCreate: vi.fn(),
  phaseGate: vi.fn(),
  wwmd: vi.fn(),
  initiative: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => m.auth(...a) }));
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
  },
}));
vi.mock("@/lib/work-posture/verification-depth-gate", () => ({
  checkBuildPhaseGate: (...a: unknown[]) => { trace.push("gate:structural-phase-gate"); return m.phaseGate(...a); },
}));
vi.mock("@/lib/decision-perspective/build-studio-gate", () => ({
  evaluateBuildStudioPlanAdvancementGate: (...a: unknown[]) => { trace.push("gate:wwmd-plan-advancement"); return m.wwmd(...a); },
}));
vi.mock("@/lib/decision-perspective/planned-file-paths", () => ({ resolvePlannedFilePaths: async () => ["apps/web/x.ts"] }));
vi.mock("@/lib/build/build-entry-gate", () => ({
  enforceBuildInitiativeReadiness: (...a: unknown[]) => { trace.push("gate:initiative-readiness"); return m.initiative(...a); },
}));
vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { emit: (...a: unknown[]) => { trace.push("event:phase-change"); return m.emit(...a); } },
}));

import { POST } from "./route";

function req(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

function planBuild(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1", buildId: "FB-1", title: "T", phase: "plan", kind: "feature",
    brief: { fixContext: undefined }, originatingBacklogItemId: "bi-row", draftApprovedAt: new Date("2026-09-01T00:00:00Z"),
    designDoc: null, designReview: null, plan: { processSize: "large" }, buildPlan: { tasks: [] }, planReview: { decision: "pass" },
    verificationOut: null, acceptanceMet: null, uxTestResults: null, uxVerificationStatus: null,
    deliberationSummary: null, threadId: "T1",
    ...overrides,
  };
}

beforeEach(() => {
  trace.length = 0;
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "user-1", platformRole: "HR-000", isSuperuser: true } });
  m.devConfig.mockResolvedValue({ governedBacklogEnabled: true });
  m.findUnique.mockResolvedValue(planBuild());
  m.update.mockResolvedValue({});
  m.activityCreate.mockResolvedValue({});
  m.phaseGate.mockResolvedValue({ allowed: true });
  m.wwmd.mockResolvedValue({
    allowed: true, interactionId: "DI-OK", operatorMessage: "ok",
    evaluation: { outcomeType: "recommend", confidenceScore: 0.9, coverageGap: false, principleConflict: false },
  });
});

describe("characterization: POST advance-phase plan→build", () => {
  it("passing build: structural gate, WWMD, one write, event, activity; 200 body", async () => {
    const res = await POST(req({ buildId: "FB-1", targetPhase: "build" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, buildId: "FB-1", from: "plan", to: "build" });
    expect(trace).toEqual([
      "gate:structural-phase-gate",
      "gate:wwmd-plan-advancement",
      'write:{"phase":"build"}',
      "event:phase-change",
      "activity:phase:advance",
    ]);
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenCalledWith({ where: { buildId: "FB-1" }, data: { phase: "build" } });
    expect(m.activityCreate).toHaveBeenCalledWith({
      data: { buildId: "FB-1", tool: "phase:advance", summary: "Phase manually advanced: plan -> build" },
    });
    expect(m.emit).toHaveBeenCalledWith("T1", { type: "phase:change", buildId: "FB-1", phase: "build" });
    expect(m.wwmd).toHaveBeenCalledWith({
      db: expect.anything(),
      build: { buildId: "FB-1", title: "T", phase: "plan", planReview: { decision: "pass" }, deliberationSummary: null },
      triggeredByUserId: "user-1",
      plannedFilePaths: ["apps/web/x.ts"],
    });
    expect(m.phaseGate).toHaveBeenCalledWith(expect.objectContaining({
      buildId: "FB-1", from: "plan", to: "build",
      evidence: expect.objectContaining({ kind: "feature", processSize: "large" }),
    }));
    expect(m.initiative).not.toHaveBeenCalled();
  });

  it("Approve Start missing: 422 before any gate", async () => {
    m.findUnique.mockResolvedValue(planBuild({ draftApprovedAt: null }));
    const res = await POST(req({ buildId: "FB-1", targetPhase: "build" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Approve Start before moving this backlog-linked draft into implementation." });
    expect(trace).toEqual([]);
  });

  it("structural gate refuses: 422 with the gate, no WWMD, no write", async () => {
    m.phaseGate.mockResolvedValue({ allowed: false, reason: "buildPlan-present required" });
    const res = await POST(req({ buildId: "FB-1", targetPhase: "build" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "buildPlan-present required",
      gate: { allowed: false, reason: "buildPlan-present required" },
    });
    expect(trace).toEqual(["gate:structural-phase-gate"]);
  });

  it("WWMD refuses: 422 with the decision interaction, no write", async () => {
    m.wwmd.mockResolvedValue({
      allowed: false, interactionId: "DI-NO", operatorMessage: "escalate first",
      evaluation: { outcomeType: "escalate", confidenceScore: 0.4, coverageGap: true, principleConflict: false },
    });
    const res = await POST(req({ buildId: "FB-1", targetPhase: "build" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "escalate first",
      decisionInteraction: { interactionId: "DI-NO", outcomeType: "escalate", confidenceScore: 0.4, coverageGap: true, principleConflict: false },
    });
    expect(trace).toEqual(["gate:structural-phase-gate", "gate:wwmd-plan-advancement"]);
  });

  it("WWMD evaluator throws: the route rejects (no fail-open), no write", async () => {
    m.wwmd.mockRejectedValue(new Error("oracle down"));
    await expect(POST(req({ buildId: "FB-1", targetPhase: "build" }))).rejects.toThrow("oracle down");
    expect(m.update).not.toHaveBeenCalled();
  });

  it("review→build (out of scope) stays a direct write without WWMD", async () => {
    m.findUnique.mockResolvedValue(planBuild({ phase: "review" }));
    const res = await POST(req({ buildId: "FB-1", targetPhase: "build" }));
    expect(res.status).toBe(200);
    expect(trace).toEqual([
      "gate:structural-phase-gate",
      'write:{"phase":"build"}',
      "event:phase-change",
      "activity:phase:advance",
    ]);
  });
});
