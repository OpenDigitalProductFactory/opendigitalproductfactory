// REPRODUCTION (BI-BDB63485) — expected to FAIL on main until the fix lands.
//
// Expresses the EXPECTED behaviour of save_phase_handoff's auto-advance:
// - AC-HANDOFF-GATES: a plan→build handoff for a backlog-linked draft that has
//   not had Approve Start is refused (the canonical `advance-build-phase`
//   profile's `callerChecksBefore` includes "Approve Start";
//   lib/actions/build.ts advanceBuildPhase `requiresStartApproval`). The same
//   precondition applies to ideate→plan on the canonical path.
// - AC-COMPLETION-PATH (handler half): the handler never writes `complete`
//   itself; ship→complete happens only through reconcileBuildCompletion, which
//   checks every ship fork is terminal and the merged SHA is deployed.
//
// Neither case decides BI-5D59A982: the WWMD plan-advancement gate is asserted
// NOT to be called here (its mode on this path stays `not-evaluated-recorded`
// until that decision is recorded).
//
// Mock style follows build-evidence-extra-pack.plan-to-build.characterization.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  checkReadiness: vi.fn(),
  queueReview: vi.fn(),
  completeTerminal: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findUnique: (...a: unknown[]) => m.findUnique(...a),
      update: (...a: unknown[]) => m.featureBuildUpdate(...a),
    },
    phaseHandoff: {
      create: (...a: unknown[]) => m.handoffCreate(...a),
      update: (...a: unknown[]) => m.handoffUpdate(...a),
      findMany: (...a: unknown[]) => m.handoffFindMany(...a),
    },
  },
}));
vi.mock("@/lib/mcp/build-tool-helpers", () => ({
  resolveActiveBuildId: async () => "FB-1",
  extractBuildIdHint: () => undefined,
  logBuildActivity: (...a: unknown[]) => m.activity(...a),
}));
vi.mock("@/lib/work-posture/verification-depth-gate", () => ({
  checkBuildPhaseGate: (...a: unknown[]) => m.phaseGate(...a),
}));
vi.mock("@/lib/decision-perspective/build-studio-gate", () => ({
  evaluateBuildStudioPlanAdvancementGate: (...a: unknown[]) => m.wwmd(...a),
}));
vi.mock("@/lib/build/build-entry-gate", () => ({
  enforceBuildInitiativeReadiness: (...a: unknown[]) => m.initiative(...a),
  checkBuildPhaseInitiativeReadiness: (...a: unknown[]) => m.checkReadiness(...a),
}));
vi.mock("@/lib/agent-event-bus", () => ({ agentEventBus: { emit: (...a: unknown[]) => m.emit(...a) } }));
vi.mock("@/lib/build-review-verification-trigger", () => ({
  queueBuildReviewVerification: (...a: unknown[]) => m.queueReview(...a),
}));
vi.mock("@/lib/backlog/initiative-readiness/build-terminal-transition", () => ({
  completeFeatureBuildTransition: (...a: unknown[]) => m.completeTerminal(...a),
  assertFeatureBuildCompletion: vi.fn(),
}));
vi.mock("@/lib/build-flow-state", () => ({
  reconcileBuildCompletion: (...a: unknown[]) => m.reconcile(...a),
}));
vi.mock("@/lib/actions/external-evidence", () => ({ recordExternalEvidence: vi.fn() }));

import { buildEvidenceExtraPack } from "./build-evidence-extra-pack";

const handoff = buildEvidenceExtraPack.handlers.save_phase_handoff;
const CTX = { agentId: "AGT-ORCH-200", routeContext: "/build" } as never;

function buildIn(phase: string, overrides: Record<string, unknown> = {}) {
  m.findUnique.mockResolvedValue({
    id: "row-1", buildId: "FB-1", phase, kind: "feature", threadId: "T1", createdById: "u1",
    designDoc: null, designReview: null, buildPlan: null, planReview: null,
    verificationOut: { typecheckPassed: true, testsFailed: 0, buildPassed: true },
    acceptanceMet: null, uxTestResults: null, uxVerificationStatus: "complete",
    brief: { acceptanceCriteria: ["a"] }, plan: { processSize: "small" },
    sandboxId: "sbx-1",
    ...overrides,
  });
}

const phaseWrites = (phase: string) =>
  m.featureBuildUpdate.mock.calls.filter(
    ([arg]) => (arg as { data?: { phase?: string } }).data?.phase === phase,
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.handoffCreate.mockResolvedValue({ id: "H1" });
  m.handoffUpdate.mockResolvedValue({});
  m.handoffFindMany.mockResolvedValue([]);
  m.featureBuildUpdate.mockResolvedValue({});
  // The structural gate ALLOWS, so any refusal must come from the missing gates.
  m.phaseGate.mockResolvedValue({ allowed: true });
  m.initiative.mockResolvedValue({ allowed: true });
  m.checkReadiness.mockResolvedValue(null);
  m.queueReview.mockResolvedValue(undefined);
  m.completeTerminal.mockResolvedValue({ ok: true });
  // Forks not all terminal / merged SHA not deployed: reconcile declines.
  m.reconcile.mockResolvedValue(false);
});

describe("REPRO BI-BDB63485 AC-HANDOFF-GATES — Approve Start on save_phase_handoff", () => {
  it("refuses plan→build for a backlog-linked draft without Approve Start (draftApprovedAt null)", async () => {
    buildIn("plan", { originatingBacklogItemId: "BI-ORIGIN01", draftApprovedAt: null });
    const res = await handoff({ summary: "plan done" }, "u1", CTX);

    expect.soft(phaseWrites("build"), "no plan→build write without Approve Start").toEqual([]);
    expect.soft(res.message).not.toBe("Phase advanced: plan → build");
    expect.soft(res.message).toMatch(/Approve Start/);
    // BI-5D59A982 is not pre-empted: the WWMD gate is still not evaluated on this path.
    expect(m.wwmd).not.toHaveBeenCalled();
  });

  it("refuses ideate→plan for a backlog-linked draft without Approve Start", async () => {
    buildIn("ideate", { originatingBacklogItemId: "BI-ORIGIN01", draftApprovedAt: null });
    const res = await handoff({ summary: "design done" }, "u1", CTX);

    expect.soft(phaseWrites("plan"), "no ideate→plan write without Approve Start").toEqual([]);
    expect.soft(res.message).not.toBe("Phase advanced: ideate → plan");
    expect.soft(res.message).toMatch(/Approve Start/);
  });
});

describe("REPRO BI-BDB63485 AC-COMPLETION-PATH — save_phase_handoff never writes `complete` itself", () => {
  it("a build in ship with unfinished forks / undeployed SHA is not completed by the handoff", async () => {
    buildIn("ship");
    const res = await handoff({ summary: "shipped" }, "u1", CTX);

    // The handler must not run the terminal transition directly (that skips
    // reconcileBuildCompletion's fork + deploy checks).
    expect.soft(m.completeTerminal, "completeFeatureBuildTransition called directly by save_phase_handoff").not.toHaveBeenCalled();
    expect.soft(phaseWrites("complete")).toEqual([]);
    expect.soft(res.message).not.toBe("Phase advanced: ship → complete");
  });
});
