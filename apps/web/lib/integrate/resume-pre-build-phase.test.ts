import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const queueBuildReviewVerificationMock = vi.fn();
const dispatchIdeateMock = vi.fn();
const dispatchDesignFixMock = vi.fn();
const dispatchPlanMock = vi.fn();
const executeToolMock = vi.fn();
const txFindUniqueMock = vi.fn();
const txUpdateMock = vi.fn();
const txActivityCreateMock = vi.fn();
const platformDevConfigFindUniqueMock = vi.fn();
const autoResolveDecomposeMock = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: { findUnique: (...args: unknown[]) => findUniqueMock(...args) },
    platformDevConfig: { findUnique: (...args: unknown[]) => platformDevConfigFindUniqueMock(...args) },
    // abandonStrandedPreBuild wraps its work in a $transaction; run the callback
    // immediately with a tx exposing the row re-check + mutation methods.
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        featureBuild: {
          findUnique: (...args: unknown[]) => txFindUniqueMock(...args),
          update: (...args: unknown[]) => txUpdateMock(...args),
        },
        buildActivity: { create: (...args: unknown[]) => txActivityCreateMock(...args) },
      }),
  },
}));
vi.mock("@/lib/build/auto-resolve-decompose-gate", () => ({
  autoResolveDecomposeRequiredGate: (...args: unknown[]) => autoResolveDecomposeMock(...args),
}));
vi.mock("@/lib/build-review-verification-trigger", () => ({
  queueBuildReviewVerification: (...args: unknown[]) => queueBuildReviewVerificationMock(...args),
}));
vi.mock("@/lib/integrate/ideate-on-approval", () => ({
  dispatchIdeateForApprovedBuild: (...args: unknown[]) => dispatchIdeateMock(...args),
  dispatchDesignReviewFixLoop: (...args: unknown[]) => dispatchDesignFixMock(...args),
}));
vi.mock("@/lib/integrate/plan-on-approval", () => ({
  dispatchPlanForApprovedBuild: (...args: unknown[]) => dispatchPlanMock(...args),
}));
vi.mock("@/lib/mcp-tools", () => ({
  executeTool: (...args: unknown[]) => executeToolMock(...args),
}));
const performPlanToBuildTransitionMock = vi.fn();
vi.mock("@/lib/integrate/plan-to-build-transition", () => ({
  performPlanToBuildTransition: (...args: unknown[]) => performPlanToBuildTransitionMock(...args),
}));

import {
  resumePreBuildPhase,
  isStrandedPreBuildAbandonable,
  abandonStrandedPreBuild,
  STRANDED_ABANDON_MS,
} from "./resume-pre-build-phase";

describe("resumePreBuildPhase (BI-9257CF19)", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    queueBuildReviewVerificationMock.mockReset().mockResolvedValue(undefined);
    dispatchIdeateMock.mockReset().mockResolvedValue({ kind: "dispatched-success" });
    dispatchDesignFixMock.mockReset().mockResolvedValue({ kind: "repaired", rounds: 1 });
    dispatchPlanMock.mockReset().mockResolvedValue({ kind: "dispatched-success" });
    executeToolMock.mockReset().mockResolvedValue({ success: true, message: "Plan review: pass." });
    // Default to a non-governed install so the existing park-guard tests exercise
    // the operator-driven behavior; governed autopilot tests override this.
    platformDevConfigFindUniqueMock.mockReset().mockResolvedValue({ governedBacklogEnabled: false });
    autoResolveDecomposeMock.mockReset().mockResolvedValue({ action: "park" });
    performPlanToBuildTransitionMock.mockReset().mockResolvedValue({ kind: "advanced" });
  });

  it("re-queues review verification for a stranded review-phase build", async () => {
    const out = await resumePreBuildPhase({ buildId: "FB-1", phase: "review", userId: "u1" });
    expect(queueBuildReviewVerificationMock).toHaveBeenCalledWith("FB-1");
    expect(findUniqueMock).not.toHaveBeenCalled(); // review path doesn't need the row
    expect(out.kind).toBe("resumed");
  });

  it("re-dispatches plan generation when no plan exists yet", async () => {
    findUniqueMock.mockResolvedValue({ designDoc: { x: 1 }, buildPlan: null });
    const out = await resumePreBuildPhase({ buildId: "FB-2", phase: "plan", userId: "u2" });
    expect(dispatchPlanMock).toHaveBeenCalledWith({ buildId: "FB-2", userId: "u2" });
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "resumed", via: "dispatchPlanForApprovedBuild" });
  });

  it("re-runs the canonical plan review when a plan already exists (refreshes a stale failed review)", async () => {
    findUniqueMock.mockResolvedValue({ designDoc: { x: 1 }, buildPlan: { tasks: [{ title: "t" }] } });
    const out = await resumePreBuildPhase({ buildId: "FB-3", phase: "plan", userId: "u3" });
    expect(executeToolMock).toHaveBeenCalledWith("reviewBuildPlan", { buildId: "FB-3" }, "u3", { featureBuildId: "FB-3" });
    expect(dispatchPlanMock).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "resumed", via: "executeTool:reviewBuildPlan" });
  });

  it("REGENERATES via the fix loop when the existing plan's last review FAILED (does not re-review the bad plan)", async () => {
    findUniqueMock.mockResolvedValue({
      designDoc: { x: 1 },
      buildPlan: { tasks: [{ title: "t" }] },
      planReview: { decision: "fail", issues: [{ severity: "critical", description: "points at files that do not exist" }] },
    });
    const out = await resumePreBuildPhase({ buildId: "FB-3F", phase: "plan", userId: "u3" });
    expect(dispatchPlanMock).toHaveBeenCalledWith({ buildId: "FB-3F", userId: "u3", forceRegenerate: true });
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "resumed", via: "dispatchPlanForApprovedBuild:repair" });
  });

  // ── Plan→build reconciler (BI-05208DE5) ──────────────────────────────────
  // A build with a COMPLETE plan whose review already PASSED is stranded only
  // because the transition side-effect (startBuildBranch) failed — the WWMD
  // decision already recommends. Resume must perform the transition DIRECTLY,
  // NOT re-run the expensive reviewBuildPlan (which re-mints a deliberation that
  // stalls and floods).
  it("reconciles a complete + passed plan straight to build without re-running reviewBuildPlan", async () => {
    findUniqueMock.mockResolvedValue({
      designDoc: { x: 1 },
      buildPlan: { tasks: [{ title: "t" }] },
      planReview: { decision: "pass" },
    });
    const out = await resumePreBuildPhase({ buildId: "FB-RC", phase: "plan", userId: "uRC" });
    expect(performPlanToBuildTransitionMock).toHaveBeenCalledWith({ buildId: "FB-RC", userId: "uRC" });
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(dispatchPlanMock).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "resumed", via: "performPlanToBuildTransition" });
  });

  it("returns skipped (auto-resume paused) once the plan→build transition has escalated", async () => {
    findUniqueMock.mockResolvedValue({
      designDoc: { x: 1 },
      buildPlan: { tasks: [{ title: "t" }] },
      planReview: { decision: "pass" },
      parentEpicId: "cmr-epic",
    });
    performPlanToBuildTransitionMock.mockResolvedValue({ kind: "escalated", failures: 3, reason: "startBuildBranch failed" });
    const out = await resumePreBuildPhase({ buildId: "FB-ESC", phase: "plan", userId: "uESC" });
    expect(performPlanToBuildTransitionMock).toHaveBeenCalledOnce();
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(out.kind).toBe("skipped");
    expect((out as { reason: string }).reason).toContain("escalated");
  });

  it("still runs the canonical plan review (not the reconciler) when no review verdict exists yet", async () => {
    findUniqueMock.mockResolvedValue({ designDoc: { x: 1 }, buildPlan: { tasks: [{ title: "t" }] } });
    const out = await resumePreBuildPhase({ buildId: "FB-NOREV", phase: "plan", userId: "uNR" });
    expect(performPlanToBuildTransitionMock).not.toHaveBeenCalled();
    expect(executeToolMock).toHaveBeenCalledWith("reviewBuildPlan", { buildId: "FB-NOREV" }, "uNR", { featureBuildId: "FB-NOREV" });
    expect(out).toMatchObject({ kind: "resumed", via: "executeTool:reviewBuildPlan" });
  });

  it("re-dispatches ideate research when no design doc exists yet", async () => {
    findUniqueMock.mockResolvedValue({ designDoc: null, buildPlan: null });
    const out = await resumePreBuildPhase({ buildId: "FB-4", phase: "ideate", userId: "u4" });
    expect(dispatchIdeateMock).toHaveBeenCalledWith({ buildId: "FB-4", userId: "u4" });
    expect(out).toMatchObject({ kind: "resumed", via: "dispatchIdeateForApprovedBuild" });
  });

  it("re-runs the canonical design review when a design doc already exists", async () => {
    findUniqueMock.mockResolvedValue({ designDoc: { problemStatement: "p" }, buildPlan: null });
    const out = await resumePreBuildPhase({ buildId: "FB-5", phase: "ideate", userId: "u5" });
    expect(executeToolMock).toHaveBeenCalledWith("reviewDesignDoc", { buildId: "FB-5" }, "u5", { featureBuildId: "FB-5" });
    expect(dispatchIdeateMock).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "resumed", via: "executeTool:reviewDesignDoc" });
  });

  // ── Decompose-gate park guard (BI-BD4F2D0D) ───────────────────────────────
  // A design that passed review but is sized `decompose-required` is parked at
  // the Phase-4b gate, not stranded. Resuming it MUST NOT re-dispatch the
  // ~847s ideate research nor re-run reviewDesignDoc (both just re-fire the
  // gate forever, burning cloud AI quota) — it proposes candidates once and parks.
  it("does NOT re-ideate a decompose-required build that passed review — proposes candidates once and parks", async () => {
    findUniqueMock.mockResolvedValue({
      designDoc: { problemStatement: "p" },
      buildPlan: null,
      designReview: { decision: "pass", sizeAssessment: { decision: "decompose-required" } },
    });
    executeToolMock.mockResolvedValue({ success: true, message: "Proposed 3 candidate decomposition(s) for FB-DR." });
    const out = await resumePreBuildPhase({ buildId: "FB-DR", phase: "ideate", userId: "uDR" });

    // The expensive pre-build paths are NOT taken.
    expect(dispatchIdeateMock).not.toHaveBeenCalled();
    expect(dispatchDesignFixMock).not.toHaveBeenCalled();
    // It proposes decomposition (the productive alternative), NOT reviewDesignDoc.
    expect(executeToolMock).toHaveBeenCalledWith(
      "propose_build_decomposition",
      { buildId: "FB-DR" },
      "uDR",
      { featureBuildId: "FB-DR" },
    );
    expect(executeToolMock).not.toHaveBeenCalledWith(
      "reviewDesignDoc",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(out.kind).toBe("skipped");
    expect((out as { reason: string }).reason).toContain("decompose-required");
  });

  it("does NOT re-propose (or re-ideate) when a parked decompose-required build already has candidates", async () => {
    findUniqueMock.mockResolvedValue({
      designDoc: { problemStatement: "p" },
      buildPlan: null,
      designReview: {
        decision: "pass",
        sizeAssessment: { decision: "decompose-required" },
        decompositionCandidates: { latest: [{ candidateId: "candidate-1", childScopes: [] }] },
      },
    });
    const out = await resumePreBuildPhase({ buildId: "FB-DR2", phase: "ideate", userId: "uDR2" });

    // Pure park: no LLM-bearing work at all (no propose, no review, no ideate).
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(dispatchIdeateMock).not.toHaveBeenCalled();
    expect(dispatchDesignFixMock).not.toHaveBeenCalled();
    expect(out.kind).toBe("skipped");
    expect((out as { reason: string }).reason).toContain("candidates already exist");
  });

  // ── Governed-backlog autopilot (BI-C4F828B7) ─────────────────────────────
  // On a governed install an auto-promoted parked build is resolved
  // autonomously here (the reviewDesignDoc gate never sees an ALREADY-parked
  // build — it is short-circuited on every resume), instead of parking forever.
  it("auto-decomposes a parked governed-autopilot build instead of parking it", async () => {
    findUniqueMock.mockResolvedValue({
      designDoc: { problemStatement: "p" },
      buildPlan: null,
      designReview: {
        decision: "pass",
        sizeAssessment: { decision: "decompose-required" },
        decompositionCandidates: { latest: [{ candidateId: "candidate-1", childScopes: [] }] },
      },
      originatingBacklogItemId: "bi-1",
      parentEpicId: null,
    });
    platformDevConfigFindUniqueMock.mockResolvedValue({ governedBacklogEnabled: true });
    autoResolveDecomposeMock.mockResolvedValue({
      action: "decomposed",
      epicId: "EP-XYZ",
      childBuildIds: ["FB-C1", "FB-C2"],
      candidateId: "candidate-1",
    });
    const out = await resumePreBuildPhase({ buildId: "FB-AP", phase: "ideate", userId: "uAP" });

    expect(autoResolveDecomposeMock).toHaveBeenCalledOnce();
    // Did NOT fall back to the propose-and-park path.
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(dispatchIdeateMock).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "resumed", via: "autoResolveDecomposeRequiredGate" });
  });

  // BI-1D0CA7A0 — the duplicate-promotion strand. Live symptom: two builds off
  // the same BacklogItem (the tee-up re-promoted it after the first was
  // superseded into an Epic) meant every restart/swap re-attempted decomposition
  // and logged `prisma:error ... Unique constraint failed on the fields:
  // (originatingBacklogItemId)`. Resume must report it and stop, NOT re-attempt
  // and NOT fall through to ideate re-dispatch or a review re-run.
  it("stops without re-attempting when the backlog item is already decomposed", async () => {
    findUniqueMock.mockResolvedValue({
      designDoc: { problemStatement: "p" },
      buildPlan: null,
      designReview: {
        decision: "pass",
        sizeAssessment: { decision: "decompose-required" },
        decompositionCandidates: { latest: [{ candidateId: "candidate-1", childScopes: [] }] },
      },
      originatingBacklogItemId: "bi-1",
      parentEpicId: null,
    });
    platformDevConfigFindUniqueMock.mockResolvedValue({ governedBacklogEnabled: true });
    autoResolveDecomposeMock.mockResolvedValue({
      action: "already-decomposed",
      existingEpicId: "EP-5F45F138",
      detail: "Backlog item BI-C47A568C is already decomposed into Epic EP-5F45F138.",
    });

    const first = await resumePreBuildPhase({ buildId: "FB-DUP", phase: "ideate", userId: "uD" });
    const second = await resumePreBuildPhase({ buildId: "FB-DUP", phase: "ideate", userId: "uD" });

    for (const out of [first, second]) {
      expect(out.kind).toBe("skipped");
      expect(out).toMatchObject({
        reason: expect.stringContaining("EP-5F45F138"),
      });
    }
    // No expensive re-work on either pass: no ideate re-dispatch, no review
    // re-run, no propose_build_decomposition.
    expect(dispatchIdeateMock).not.toHaveBeenCalled();
    expect(executeToolMock).not.toHaveBeenCalled();
  });

  it("advances a parked governed-autopilot build after an auto-override (re-runs review, does not park)", async () => {
    findUniqueMock.mockResolvedValue({
      designDoc: { problemStatement: "p" },
      buildPlan: null,
      designReview: {
        decision: "pass",
        sizeAssessment: { decision: "decompose-required" },
      },
      originatingBacklogItemId: "bi-1",
      parentEpicId: null,
    });
    platformDevConfigFindUniqueMock.mockResolvedValue({ governedBacklogEnabled: true });
    autoResolveDecomposeMock.mockResolvedValue({
      action: "overridden",
      rationale: "no candidates",
      reason: "no-candidates",
    });
    const out = await resumePreBuildPhase({ buildId: "FB-AO", phase: "ideate", userId: "uAO" });

    // Override recorded → falls through to re-run reviewDesignDoc so it advances.
    expect(executeToolMock).toHaveBeenCalledWith("reviewDesignDoc", { buildId: "FB-AO" }, "uAO", { featureBuildId: "FB-AO" });
    expect(out).toMatchObject({ kind: "resumed", via: "executeTool:reviewDesignDoc" });
  });

  it("does NOT park a decompose-required build once an operator override is recorded — re-runs review so it can advance", async () => {
    findUniqueMock.mockResolvedValue({
      designDoc: { problemStatement: "p" },
      buildPlan: null,
      designReview: {
        decision: "pass",
        sizeAssessment: { decision: "decompose-required" },
        decompositionOverride: { justification: "ship monolithically", at: "2026-06-20" },
      },
    });
    const out = await resumePreBuildPhase({ buildId: "FB-OV", phase: "ideate", userId: "uOV" });
    expect(executeToolMock).toHaveBeenCalledWith("reviewDesignDoc", { buildId: "FB-OV" }, "uOV", { featureBuildId: "FB-OV" });
    expect(executeToolMock).not.toHaveBeenCalledWith("propose_build_decomposition", expect.anything(), expect.anything(), expect.anything());
    expect(out).toMatchObject({ kind: "resumed", via: "executeTool:reviewDesignDoc" });
  });

  it("does NOT park a decompose-RECOMMENDED build — it is not gate-blocking, so review re-runs and advances", async () => {
    findUniqueMock.mockResolvedValue({
      designDoc: { problemStatement: "p" },
      buildPlan: null,
      designReview: { decision: "pass", sizeAssessment: { decision: "decompose-recommended" } },
    });
    const out = await resumePreBuildPhase({ buildId: "FB-REC", phase: "ideate", userId: "uREC" });
    expect(executeToolMock).toHaveBeenCalledWith("reviewDesignDoc", { buildId: "FB-REC" }, "uREC", { featureBuildId: "FB-REC" });
    expect(executeToolMock).not.toHaveBeenCalledWith("propose_build_decomposition", expect.anything(), expect.anything(), expect.anything());
    expect(out).toMatchObject({ kind: "resumed", via: "executeTool:reviewDesignDoc" });
  });

  it("runs the design-review fix loop when an existing designDoc's last review FAILED", async () => {
    findUniqueMock.mockResolvedValue({
      designDoc: { problemStatement: "p" },
      buildPlan: null,
      designReview: { decision: "fail", issues: [{ severity: "critical", description: "fails to address security" }] },
    });
    const out = await resumePreBuildPhase({ buildId: "FB-5F", phase: "ideate", userId: "u5" });
    expect(dispatchDesignFixMock).toHaveBeenCalledWith({ buildId: "FB-5F", userId: "u5" });
    expect(executeToolMock).not.toHaveBeenCalled(); // does NOT just re-review the rejected doc
    expect(out).toMatchObject({ kind: "resumed", via: "dispatchDesignReviewFixLoop" });
  });


  it("parks when design PASSed but persisted happyPath intake is still incomplete (BI-E212CAE2)", async () => {
    findUniqueMock.mockResolvedValue({
      designDoc: { problemStatement: "p" },
      buildPlan: null,
      designReview: { decision: "pass", sizeAssessment: { decision: "ok" } },
      plan: {
        happyPathState: {
          intake: {
            taxonomyNodeId: null,
            backlogItemId: "BI-X",
            epicId: "EP-X",
            constrainedGoal: null,
            status: "blocked",
            failureReason: "Intake is incomplete",
          },
        },
      },
    });
    const out = await resumePreBuildPhase({ buildId: "FB-INTAKE", phase: "ideate", userId: "uI" });
    expect(executeToolMock).not.toHaveBeenCalled();
    expect(dispatchIdeateMock).not.toHaveBeenCalled();
    expect(out.kind).toBe("skipped");
    expect((out as { reason: string }).reason).toContain("intake is incomplete");
  });

  it("returns failed (never throws) when the build row is missing", async () => {
    findUniqueMock.mockResolvedValue(null);
    const out = await resumePreBuildPhase({ buildId: "FB-6", phase: "plan", userId: "u6" });
    expect(out).toEqual({ kind: "failed", phase: "plan", error: "build not found" });
  });

  it("returns failed (never throws) when a dispatcher rejects", async () => {
    findUniqueMock.mockResolvedValue({ designDoc: { x: 1 }, buildPlan: null });
    dispatchPlanMock.mockRejectedValue(new Error("boom"));
    const out = await resumePreBuildPhase({ buildId: "FB-7", phase: "plan", userId: "u7" });
    expect(out).toMatchObject({ kind: "failed", phase: "plan" });
    expect((out as { error: string }).error).toContain("boom");
  });
});

// ── Age-out cap (BI-A009313E) ───────────────────────────────────────────────
describe("isStrandedPreBuildAbandonable", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  const old = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days
  const recent = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour
  const thresholdMs = 7 * 24 * 60 * 60 * 1000;

  it("is true for a pre-build strand older than the threshold", () => {
    for (const phase of ["ideate", "plan", "review"]) {
      expect(
        isStrandedPreBuildAbandonable({ phase, createdAt: old, parentEpicId: null, now, thresholdMs }),
      ).toBe(true);
    }
  });

  it("is false for a strand younger than the threshold", () => {
    expect(
      isStrandedPreBuildAbandonable({ phase: "ideate", createdAt: recent, parentEpicId: null, now, thresholdMs }),
    ).toBe(false);
  });

  it("is false for the `build` phase (it has its own step-machine resume) and non-pre-build phases", () => {
    for (const phase of ["build", "ship", "complete", "abandoned", "failed"]) {
      expect(
        isStrandedPreBuildAbandonable({ phase, createdAt: old, parentEpicId: null, now, thresholdMs }),
      ).toBe(false);
    }
  });

  it("is false for an epic-decomposed child even when old (coordinated by the epic)", () => {
    expect(
      isStrandedPreBuildAbandonable({ phase: "ideate", createdAt: old, parentEpicId: "EP-1", now, thresholdMs }),
    ).toBe(false);
  });

  it("defaults the cap to 7 days (survives travel + weekly rate-limit reset)", () => {
    expect(STRANDED_ABANDON_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("abandonStrandedPreBuild", () => {
  beforeEach(() => {
    txFindUniqueMock.mockReset();
    txUpdateMock.mockReset().mockResolvedValue({});
    txActivityCreateMock.mockReset().mockResolvedValue({});
  });

  it("abandons a still-pre-build row, recording reason + activity", async () => {
    txFindUniqueMock.mockResolvedValue({ phase: "ideate", abandonedAt: null });
    const now = new Date("2026-07-17T12:00:00Z");
    const ok = await abandonStrandedPreBuild({ buildId: "FB-DEAD", phase: "ideate", ageMs: 20 * 86_400_000, now });

    expect(ok).toBe(true);
    const updateArg = txUpdateMock.mock.calls[0]![0] as { data: { phase: string; abandonedAt: Date; abandonReason: string } };
    expect(updateArg.data.phase).toBe("abandoned");
    expect(updateArg.data.abandonedAt).toBe(now);
    expect(updateArg.data.abandonReason).toContain("Auto-aged-out");
    expect(updateArg.data.abandonReason).toContain("BI-A009313E");
    expect(txActivityCreateMock).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: no-op when the row is already abandoned", async () => {
    txFindUniqueMock.mockResolvedValue({ phase: "abandoned", abandonedAt: new Date() });
    const ok = await abandonStrandedPreBuild({ buildId: "FB-X", phase: "ideate", ageMs: 20 * 86_400_000 });
    expect(ok).toBe(false);
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("no-ops when the row advanced out of a pre-build phase since the scan", async () => {
    txFindUniqueMock.mockResolvedValue({ phase: "build", abandonedAt: null });
    const ok = await abandonStrandedPreBuild({ buildId: "FB-ADV", phase: "ideate", ageMs: 20 * 86_400_000 });
    expect(ok).toBe(false);
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("never throws — returns false when the row is missing", async () => {
    txFindUniqueMock.mockResolvedValue(null);
    const ok = await abandonStrandedPreBuild({ buildId: "FB-GONE", phase: "ideate", ageMs: 20 * 86_400_000 });
    expect(ok).toBe(false);
  });
});
