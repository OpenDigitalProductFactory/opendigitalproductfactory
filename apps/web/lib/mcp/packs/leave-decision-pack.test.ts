import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  propose: vi.fn(),
}));

vi.mock("@/lib/workforce/leave/leave-decision-runtime", () => ({
  decideLeaveRequestFromData: mocks.decide,
}));
vi.mock("@/lib/workforce/leave/decide-proposal", () => ({
  proposeLeaveDecision: mocks.propose,
}));

import { leaveDecisionPack } from "./leave-decision-pack";

describe("leaveDecisionPack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decide.mockResolvedValue({
      action: "approve",
      interactionId: "DI-1",
      orgProfileSelected: true,
      operatorMessage: "Approve under the recorded staffing stance.",
      guardReasons: [],
      request: { requestId: "LR-1" },
      inputs: { organizationId: "org-1" },
    });
    mocks.propose.mockResolvedValue({ proposalId: "leave-decision:LR-1:DI-1", status: "proposed" });
  });

  it("declares a propose-only coworker artifact with the mirrored existing grants", () => {
    expect(leaveDecisionPack.packId).toBe("leave-decision");
    expect(leaveDecisionPack.definitions).toHaveLength(1);
    const def = leaveDecisionPack.definitions[0];
    expect(def.name).toBe("propose_leave_decision");
    expect(def.sideEffect).toBe(true);
    expect(def.coworkerArtifact).toBe(true);
    expect(def.executionMode).toBe("immediate");
    expect(def.requiredCapability).toBe("view_employee");
    expect(leaveDecisionPack.grants.propose_leave_decision).toEqual([
      "consumer_read",
      "registry_read",
    ]);
  });

  it("runs WWWD + guards, then persists a proposed action without deciding leave", async () => {
    const handler = leaveDecisionPack.handlers.propose_leave_decision;
    const result = await handler(
      { requestId: "LR-1", organizationId: "org-1", minCoverageCushion: 1 },
      "user-1",
      { agentId: "time-off-advisor", threadId: "thread-1", taskRunId: "run-1" } as never,
    );

    expect(mocks.decide).toHaveBeenCalledWith({
      requestId: "LR-1",
      organizationId: "org-1",
      minCoverageCushion: 1,
    });
    expect(mocks.propose).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      agentId: "time-off-advisor",
      threadId: "thread-1",
      taskRunId: "run-1",
    }));
    expect(result).toMatchObject({
      success: true,
      entityId: "leave-decision:LR-1:DI-1",
      data: {
        status: "proposed",
        recommendation: "approve",
        interactionId: "DI-1",
      },
    });
  });

  it("rejects malformed input before reading leave data", async () => {
    const result = await leaveDecisionPack.handlers.propose_leave_decision({}, "user-1", {} as never);
    expect(result.success).toBe(false);
    expect(result.error).toBe("requestId and organizationId are required");
    expect(mocks.decide).not.toHaveBeenCalled();
  });
});
