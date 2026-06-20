import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const queueBuildReviewVerificationMock = vi.fn();
const dispatchIdeateMock = vi.fn();
const dispatchDesignFixMock = vi.fn();
const dispatchPlanMock = vi.fn();
const executeToolMock = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: { featureBuild: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
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

import { resumePreBuildPhase } from "./resume-pre-build-phase";

describe("resumePreBuildPhase (BI-9257CF19)", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    queueBuildReviewVerificationMock.mockReset().mockResolvedValue(undefined);
    dispatchIdeateMock.mockReset().mockResolvedValue({ kind: "dispatched-success" });
    dispatchDesignFixMock.mockReset().mockResolvedValue({ kind: "repaired", rounds: 1 });
    dispatchPlanMock.mockReset().mockResolvedValue({ kind: "dispatched-success" });
    executeToolMock.mockReset().mockResolvedValue({ success: true, message: "Plan review: pass." });
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
