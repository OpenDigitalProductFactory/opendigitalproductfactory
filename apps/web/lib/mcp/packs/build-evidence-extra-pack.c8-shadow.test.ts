// BI-45F9CB7A — GPP C-8 transition-path shadow (Phase 1, T4; acceptance AC-C8-SHADOW).
//
// `advanceBuildPhase` enforces Approve Start, initiative readiness, the evidence
// gate, the dependency gate and the blocking WWMD plan-advancement gate on
// plan→build. `save_phase_handoff` auto-advances plan→build after the evidence
// gate alone. Its auto-advance predates the WWMD gate (#64, 2026-04-06, vs
// #735, 2026-05-17). Phase 1 only RECORDS that the gate was skipped: no gate
// call, no refusal, and no change to the transition outcome.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  featureBuildUpdate: vi.fn(),
  handoffCreate: vi.fn(),
  handoffUpdate: vi.fn(),
  handoffFindMany: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findUnique: (...a: unknown[]) => db.findUnique(...a),
      update: (...a: unknown[]) => db.featureBuildUpdate(...a),
    },
    phaseHandoff: {
      create: (...a: unknown[]) => db.handoffCreate(...a),
      update: (...a: unknown[]) => db.handoffUpdate(...a),
      findMany: (...a: unknown[]) => db.handoffFindMany(...a),
    },
  },
}));

const activity = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mcp/build-tool-helpers", () => ({
  resolveActiveBuildId: async () => "B1",
  extractBuildIdHint: () => undefined,
  logBuildActivity: (...a: unknown[]) => activity(...a),
}));

vi.mock("@/lib/work-posture/verification-depth-gate", () => ({
  checkBuildPhaseGate: async () => ({ allowed: true }),
}));

vi.mock("@/lib/actions/external-evidence", () => ({ recordExternalEvidence: vi.fn() }));

import { buildEvidenceExtraPack } from "./build-evidence-extra-pack";

const handoff = buildEvidenceExtraPack.handlers.save_phase_handoff;
const SKIPPED = "gpp-c8-transition-gate-skipped";

function buildIn(phase: string) {
  db.findUnique.mockResolvedValue({
    buildId: "B1", phase, kind: "feature", threadId: null,
    designDoc: null, designReview: null, buildPlan: null, planReview: null,
    verificationOut: null, acceptanceMet: null, uxTestResults: null, uxVerificationStatus: null,
    brief: {}, plan: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.handoffCreate.mockResolvedValue({ id: "H1" });
  db.handoffUpdate.mockResolvedValue({});
  db.handoffFindMany.mockResolvedValue([]);
  db.featureBuildUpdate.mockResolvedValue({});
});

describe("save_phase_handoff plan→build records the skipped WWMD gate (shadow only)", () => {
  it("records exactly one gate-skipped event and still advances exactly as before", async () => {
    buildIn("plan");
    const res = await handoff({ summary: "plan done" }, "u1", { agentId: "AGT-ORCH-200", routeContext: "/build" } as never);

    expect(res.success).toBe(true);
    expect(db.featureBuildUpdate).toHaveBeenCalledWith({ where: { buildId: "B1" }, data: { phase: "build" } });
    const skipped = activity.mock.calls.filter((call) => call[1] === SKIPPED);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]![0]).toBe("B1");
    expect(String(skipped[0]![2])).toContain("WWMD plan-advancement gate");
  });

  it("does not fire for the orchestrator's internal handoff, which does not auto-advance", async () => {
    buildIn("plan");
    await handoff(
      { summary: "task done", toPhase: "build", autoAdvance: false },
      "u1",
      { agentId: "AGT-ORCH-300", routeContext: "/build" } as never,
    );
    expect(activity.mock.calls.filter((call) => call[1] === SKIPPED)).toHaveLength(0);
    expect(db.featureBuildUpdate).not.toHaveBeenCalled();
  });

  it("does not fire for other transitions", async () => {
    buildIn("build");
    await handoff({ summary: "build done" }, "u1", { agentId: "AGT-ORCH-300", routeContext: "/build" } as never);
    expect(activity.mock.calls.filter((call) => call[1] === SKIPPED)).toHaveLength(0);
  });

  // Written now, enabled only after the separate enforcement decision that
  // follows the shadow evidence (plan T4). Do not unskip without that decision.
  it.skip("enforcement (later): plan→build via save_phase_handoff is refused when the WWMD gate refuses", () => {});
});
