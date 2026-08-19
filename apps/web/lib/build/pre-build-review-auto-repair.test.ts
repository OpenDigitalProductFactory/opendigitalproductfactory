import { beforeEach, describe, expect, it, vi } from "vitest";

const buildActivityCreateMock = vi.fn();
const inngestSendMock = vi.fn();
const dispatchDesignReviewFixLoopMock = vi.fn();
const dispatchPlanForApprovedBuildMock = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    buildActivity: {
      create: (...args: unknown[]) => buildActivityCreateMock(...args),
    },
  },
}));

vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: {
    send: (...args: unknown[]) => inngestSendMock(...args),
  },
}));

vi.mock("@/lib/build/ideate-on-approval", () => ({
  dispatchDesignReviewFixLoop: (...args: unknown[]) => dispatchDesignReviewFixLoopMock(...args),
}));

vi.mock("@/lib/build/plan-on-approval", () => ({
  dispatchPlanForApprovedBuild: (...args: unknown[]) => dispatchPlanForApprovedBuildMock(...args),
}));

import {
  triggerDesignReviewAutoRepair,
  triggerPlanReviewAutoRepair,
} from "./pre-build-review-auto-repair";

describe("pre-build review auto-repair trigger", () => {
  beforeEach(() => {
    buildActivityCreateMock.mockReset().mockResolvedValue({});
    inngestSendMock.mockReset().mockResolvedValue({ ids: ["evt-1"] });
    dispatchDesignReviewFixLoopMock.mockReset().mockResolvedValue({ kind: "repaired", rounds: 1 });
    dispatchPlanForApprovedBuildMock.mockReset().mockResolvedValue({ kind: "dispatched-success" });
  });

  it("queues design review repair durably instead of running the fix loop inside the request", async () => {
    await triggerDesignReviewAutoRepair("FB-DESIGN", "usr-1");

    expect(inngestSendMock).toHaveBeenCalledWith({
      name: "build/pre-build-review.repair",
      data: { buildId: "FB-DESIGN", userId: "usr-1", kind: "design" },
    });
    expect(dispatchDesignReviewFixLoopMock).not.toHaveBeenCalled();
    expect(buildActivityCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buildId: "FB-DESIGN",
        tool: "design_fix_loop",
        summary: expect.stringContaining("queued"),
      }),
    });
  });

  it("queues plan review repair durably with force-regenerate handled by the worker", async () => {
    await triggerPlanReviewAutoRepair("FB-PLAN", "usr-2");

    expect(inngestSendMock).toHaveBeenCalledWith({
      name: "build/pre-build-review.repair",
      data: { buildId: "FB-PLAN", userId: "usr-2", kind: "plan" },
    });
    expect(dispatchPlanForApprovedBuildMock).not.toHaveBeenCalled();
  });

  it("does not enqueue when the caller suppresses auto-repair", async () => {
    await triggerDesignReviewAutoRepair("FB-SUPPRESS", "usr-3", {
      suppressDesignReviewAutoRepair: true,
    });

    expect(inngestSendMock).not.toHaveBeenCalled();
    expect(buildActivityCreateMock).not.toHaveBeenCalled();
  });

  it("logs enqueue failure without throwing into the review tool", async () => {
    inngestSendMock.mockRejectedValue(new Error("queue unavailable"));

    await expect(triggerPlanReviewAutoRepair("FB-FAIL", "usr-4")).resolves.toBeUndefined();

    expect(buildActivityCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buildId: "FB-FAIL",
        tool: "plan_dispatch",
        summary: expect.stringContaining("failed to queue"),
      }),
    });
  });
});
