// GPP Phase 2 PR-F (C-8, BI-45F9CB7A) — characterization of the plan→build path
// through `save_phase_handoff`'s auto-advance. Written against the tree BEFORE
// the shared-transition refactor and kept unchanged after it. It pins: the only
// gate is the structural phase gate (no initiative readiness, no dependency gate,
// no WWMD call), its refusal is soft (success: true), the PR-B shadow event
// `gpp-c8-transition-gate-skipped` fires right after the write, and the order of
// writes, events and activity entries.
import { beforeEach, describe, expect, it, vi } from "vitest";

const trace = vi.hoisted(() => [] as string[]);
const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  featureBuildUpdate: vi.fn(),
  handoffCreate: vi.fn(),
  handoffUpdate: vi.fn(),
  handoffFindMany: vi.fn(),
  phaseGate: vi.fn(),
  activity: vi.fn(),
  emit: vi.fn(),
  wwmd: vi.fn(),
  initiative: vi.fn(),
  queueReview: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findUnique: (...a: unknown[]) => m.findUnique(...a),
      update: (...a: unknown[]) => {
        trace.push(`write:${JSON.stringify((a[0] as { data: unknown }).data)}`);
        return m.featureBuildUpdate(...a);
      },
    },
    phaseHandoff: {
      create: (...a: unknown[]) => { trace.push("handoff:create"); return m.handoffCreate(...a); },
      update: (...a: unknown[]) => { trace.push("handoff:gate-result"); return m.handoffUpdate(...a); },
      findMany: (...a: unknown[]) => m.handoffFindMany(...a),
    },
  },
}));
vi.mock("@/lib/mcp/build-tool-helpers", () => ({
  resolveActiveBuildId: async () => "B1",
  extractBuildIdHint: () => undefined,
  logBuildActivity: (...a: unknown[]) => { trace.push(`activity:${String(a[1])}`); return m.activity(...a); },
}));
vi.mock("@/lib/work-posture/verification-depth-gate", () => ({
  checkBuildPhaseGate: (...a: unknown[]) => { trace.push("gate:structural-phase-gate"); return m.phaseGate(...a); },
}));
vi.mock("@/lib/decision-perspective/build-studio-gate", () => ({
  evaluateBuildStudioPlanAdvancementGate: (...a: unknown[]) => { trace.push("gate:wwmd-plan-advancement"); return m.wwmd(...a); },
}));
vi.mock("@/lib/build/build-entry-gate", () => ({
  enforceBuildInitiativeReadiness: (...a: unknown[]) => { trace.push("gate:initiative-readiness"); return m.initiative(...a); },
}));
vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { emit: (...a: unknown[]) => { trace.push("event:phase-change"); return m.emit(...a); } },
}));
vi.mock("@/lib/build-review-verification-trigger", () => ({
  queueBuildReviewVerification: (...a: unknown[]) => { trace.push("queue-review"); return m.queueReview(...a); },
}));
vi.mock("@/lib/actions/external-evidence", () => ({ recordExternalEvidence: vi.fn() }));

import { buildEvidenceExtraPack } from "./build-evidence-extra-pack";

const handoff = buildEvidenceExtraPack.handlers.save_phase_handoff;
const SKIPPED = "gpp-c8-transition-gate-skipped";
const SKIPPED_SUMMARY =
  "plan → build advanced by save_phase_handoff without the WWMD plan-advancement gate (shadow; not enforced)";

function buildIn(phase: string, overrides: Record<string, unknown> = {}) {
  m.findUnique.mockResolvedValue({
    buildId: "B1", phase, kind: "feature", threadId: "T1",
    designDoc: null, designReview: null, buildPlan: null, planReview: null,
    verificationOut: null, acceptanceMet: null, uxTestResults: null, uxVerificationStatus: null,
    brief: { acceptanceCriteria: ["a"] }, plan: { processSize: "small" },
    ...overrides,
  });
}

beforeEach(() => {
  trace.length = 0;
  vi.clearAllMocks();
  m.handoffCreate.mockResolvedValue({ id: "H1" });
  m.handoffUpdate.mockResolvedValue({});
  m.handoffFindMany.mockResolvedValue([]);
  m.featureBuildUpdate.mockResolvedValue({});
  m.phaseGate.mockResolvedValue({ allowed: true });
  m.queueReview.mockResolvedValue(undefined);
});

describe("characterization: save_phase_handoff plan→build", () => {
  it("passing gate: structural gate only, write, shadow skip event, phase-change, phase:advance", async () => {
    buildIn("plan");
    const res = await handoff({ summary: "plan done" }, "u1", { agentId: "AGT-ORCH-200", routeContext: "/build" } as never);

    expect(res).toEqual({ success: true, message: "Phase advanced: plan → build" });
    expect(trace).toEqual([
      "handoff:create",
      "gate:structural-phase-gate",
      "handoff:gate-result",
      'write:{"phase":"build"}',
      `activity:${SKIPPED}`,
      "event:phase-change",
      "activity:phase:advance",
    ]);
    expect(m.featureBuildUpdate).toHaveBeenCalledTimes(1);
    expect(m.featureBuildUpdate).toHaveBeenCalledWith({ where: { buildId: "B1" }, data: { phase: "build" } });
    expect(m.activity.mock.calls).toEqual([
      ["B1", SKIPPED, SKIPPED_SUMMARY],
      ["B1", "phase:advance", "Phase advanced: plan → build"],
    ]);
    expect(m.emit).toHaveBeenCalledWith("T1", { type: "phase:change", buildId: "B1", phase: "build" });
    expect(m.handoffUpdate).toHaveBeenCalledWith({
      where: { id: "H1" },
      data: { gateResult: { allowed: true, reason: null, fromPhase: "plan", toPhase: "build" } },
    });
    expect(m.phaseGate).toHaveBeenCalledWith(expect.objectContaining({
      buildId: "B1", from: "plan", to: "build",
      evidence: expect.objectContaining({ kind: "feature", processSize: "small", acceptanceCriteria: ["a"] }),
    }));
    expect(m.wwmd).not.toHaveBeenCalled();
    expect(m.initiative).not.toHaveBeenCalled();
  });

  it("structural gate refuses: soft refusal (success: true), no write, no skip event", async () => {
    buildIn("plan");
    m.phaseGate.mockResolvedValue({ allowed: false, reason: "planReview-passed required" });
    const res = await handoff({ summary: "plan done" }, "u1", { agentId: "AGT-ORCH-200", routeContext: "/build" } as never);

    expect(res).toEqual({
      success: true,
      message: "Phase handoff saved but gate blocked advance: planReview-passed required. Evidence may be incomplete.",
    });
    expect(trace).toEqual(["handoff:create", "gate:structural-phase-gate", "handoff:gate-result"]);
    expect(m.featureBuildUpdate).not.toHaveBeenCalled();
    expect(m.activity).not.toHaveBeenCalled();
  });

  it("phase write throws: caught, handoff still reported saved", async () => {
    buildIn("plan");
    m.featureBuildUpdate.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handoff({ summary: "plan done" }, "u1", { agentId: "AGT-ORCH-200", routeContext: "/build" } as never);
    expect(res).toEqual({ success: true, message: "Phase handoff saved: plan → build" });
    expect(m.activity).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
  });

  it("orchestrator internal handoff: no gate, no write", async () => {
    buildIn("plan");
    const res = await handoff(
      { summary: "task done", toPhase: "build", autoAdvance: false },
      "u1",
      { agentId: "AGT-ORCH-300", routeContext: "/build" } as never,
    );
    expect(res).toEqual({ success: true, message: "Phase handoff saved: plan → build" });
    expect(trace).toEqual(["handoff:create"]);
  });

  it("build→review (out of scope) stays a direct write with no skip event", async () => {
    buildIn("build");
    const res = await handoff({ summary: "build done" }, "u1", { agentId: "AGT-ORCH-300", routeContext: "/build" } as never);
    expect(res).toEqual({ success: true, message: "Phase advanced: build → review" });
    expect(trace).toEqual([
      "handoff:create",
      "gate:structural-phase-gate",
      "handoff:gate-result",
      'write:{"phase":"review"}',
      "queue-review",
      "event:phase-change",
      "activity:phase:advance",
    ]);
  });

  // BI-BDB63485 rows: Approve Start is now a caller check on this path, and the
  // tool refuses phases outside its buildPhases tag. The rows above are unchanged.
  it("unapproved backlog draft: Approve Start soft refusal before the structural gate, no write", async () => {
    buildIn("plan", { originatingBacklogItemId: "BI-1", draftApprovedAt: null });
    const res = await handoff({ summary: "plan done" }, "u1", { agentId: "AGT-ORCH-200", routeContext: "/build" } as never);
    expect(res).toEqual({
      success: true,
      message: "Phase handoff saved but gate blocked advance: Approve Start before moving this backlog-linked draft into implementation. Evidence may be incomplete.",
    });
    expect(trace).toEqual(["handoff:create"]);
    expect(m.wwmd).not.toHaveBeenCalled();
    expect(m.initiative).not.toHaveBeenCalled();
  });

  it("ship (outside buildPhases): refused before the handoff row, no gate, no write", async () => {
    buildIn("ship");
    const res = await handoff({ summary: "shipped" }, "u1", { agentId: "AGT-ORCH-200", routeContext: "/build" } as never);
    expect(res).toEqual({
      success: false,
      error: "phase_out_of_scope",
      message: "save_phase_handoff works in the ideate, plan, build, review phases; build B1 is in ship. Nothing was saved.",
    });
    expect(trace).toEqual([]);
  });
});
