import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
const queueBuildReviewVerificationMock = vi.fn();
const dispatchIdeateMock = vi.fn();
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
