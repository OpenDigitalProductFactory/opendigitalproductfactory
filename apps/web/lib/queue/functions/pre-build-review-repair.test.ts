import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatchDesignReviewFixLoopMock = vi.fn();
const dispatchPlanForApprovedBuildMock = vi.fn();
const buildActivityCreateMock = vi.fn();

vi.mock("../inngest-client", () => ({
  inngest: {
    createFunction: (config: unknown, fn: unknown) => ({ config, fn }),
  },
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    buildActivity: {
      create: (...args: unknown[]) => buildActivityCreateMock(...args),
    },
  },
}));

vi.mock("@/lib/build/ideate-on-approval", () => ({
  dispatchDesignReviewFixLoop: (...args: unknown[]) => dispatchDesignReviewFixLoopMock(...args),
}));

vi.mock("@/lib/build/plan-on-approval", () => ({
  dispatchPlanForApprovedBuild: (...args: unknown[]) => dispatchPlanForApprovedBuildMock(...args),
}));

import { preBuildReviewRepair } from "./pre-build-review-repair";

const repairFunction = preBuildReviewRepair as unknown as {
  config: unknown;
  fn: (input: { event: { data: unknown }; step: ReturnType<typeof stepRunner> }) => Promise<unknown>;
};

function stepRunner() {
  return {
    run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
  };
}

describe("preBuildReviewRepair", () => {
  beforeEach(() => {
    dispatchDesignReviewFixLoopMock.mockReset().mockResolvedValue({ kind: "repaired", rounds: 1 });
    dispatchPlanForApprovedBuildMock.mockReset().mockResolvedValue({ kind: "dispatched-success" });
    buildActivityCreateMock.mockReset().mockResolvedValue({});
  });

  it("is registered on the durable pre-build review repair event", () => {
    expect(repairFunction.config).toMatchObject({
      id: "build/pre-build-review-repair",
      triggers: [{ event: "build/pre-build-review.repair" }],
    });
  });

  it("runs the design review fix loop for design repair events", async () => {
    const step = stepRunner();

    await repairFunction.fn({
      event: { data: { buildId: "FB-DESIGN", userId: "usr-1", kind: "design" } },
      step,
    });

    expect(dispatchDesignReviewFixLoopMock).toHaveBeenCalledWith({
      buildId: "FB-DESIGN",
      userId: "usr-1",
    });
    expect(dispatchPlanForApprovedBuildMock).not.toHaveBeenCalled();
  });

  it("runs the plan repair path with forceRegenerate for plan repair events", async () => {
    const step = stepRunner();

    await repairFunction.fn({
      event: { data: { buildId: "FB-PLAN", userId: "usr-2", kind: "plan" } },
      step,
    });

    expect(dispatchPlanForApprovedBuildMock).toHaveBeenCalledWith({
      buildId: "FB-PLAN",
      userId: "usr-2",
      forceRegenerate: true,
    });
    expect(dispatchDesignReviewFixLoopMock).not.toHaveBeenCalled();
  });
});
