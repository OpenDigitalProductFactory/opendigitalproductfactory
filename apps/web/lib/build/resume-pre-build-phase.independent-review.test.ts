// BI-3E57890E: a plan-phase build whose independent design review failed is
// revised from the reviewer's findings before anything retries plan→build.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock, reviseMock, transitionMock, dispatchPlanMock, executeToolMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  reviseMock: vi.fn(),
  transitionMock: vi.fn(),
  dispatchPlanMock: vi.fn(),
  executeToolMock: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: { findUnique: findUniqueMock },
    buildActivity: { findMany: vi.fn().mockResolvedValue([]) },
    backlogItemActivity: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock("@/lib/build/heal-build-workroom-shape", () => ({
  healBuildWorkroomShape: vi.fn().mockResolvedValue({ healed: false, detail: "bound" }),
}));
vi.mock("@/lib/build/independent-design-review-revision", () => ({
  reviseDesignFromIndependentReview: reviseMock,
}));
vi.mock("@/lib/build/plan-to-build-transition", () => ({ performPlanToBuildTransition: transitionMock }));
vi.mock("@/lib/build/plan-on-approval", () => ({ dispatchPlanForApprovedBuild: dispatchPlanMock }));
vi.mock("@/lib/mcp-tools", () => ({ executeTool: executeToolMock }));

import { resumePreBuildPhase } from "./resume-pre-build-phase";

describe("resumePreBuildPhase — failed independent design review (BI-3E57890E)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueMock.mockResolvedValue({
      designDoc: { problemStatement: "p" },
      designReview: { decision: "pass" },
      buildPlan: { tasks: [{ title: "t" }] },
      planReview: { decision: "pass" },
      originatingBacklogItemId: "row-1",
      parentEpicId: null,
    });
    transitionMock.mockResolvedValue({ kind: "gate-blocked", reason: "a recorded review did not pass (a design reviewer)" });
  });

  it("revises the design instead of re-running a plan→build the failed review refuses", async () => {
    reviseMock.mockResolvedValue({ kind: "resumed", via: "reviseDesignFromIndependentReview", detail: "revised" });
    const out = await resumePreBuildPhase({ buildId: "FB-IR", phase: "plan", userId: "u" });
    expect(reviseMock).toHaveBeenCalledWith({ buildId: "FB-IR", userId: "u", originatingBacklogItemId: "row-1" });
    expect(transitionMock).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: "resumed", phase: "plan", via: "reviseDesignFromIndependentReview", detail: "revised" });
  });

  it("falls through to the normal plan path when no independent design review is failing", async () => {
    reviseMock.mockResolvedValue(null);
    transitionMock.mockResolvedValue({ kind: "advanced" });
    const out = await resumePreBuildPhase({ buildId: "FB-OK", phase: "plan", userId: "u" });
    expect(transitionMock).toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "resumed", via: "performPlanToBuildTransition" });
  });

  it("does not consult the independent review for a build with no backlog item", async () => {
    findUniqueMock.mockResolvedValue({
      designDoc: { problemStatement: "p" }, designReview: { decision: "pass" },
      buildPlan: { tasks: [{ title: "t" }] }, planReview: { decision: "pass" },
      originatingBacklogItemId: null, parentEpicId: null,
    });
    transitionMock.mockResolvedValue({ kind: "advanced" });
    await resumePreBuildPhase({ buildId: "FB-NOBI", phase: "plan", userId: "u" });
    expect(reviseMock).not.toHaveBeenCalled();
  });
});
