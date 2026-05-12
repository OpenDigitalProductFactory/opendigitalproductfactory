import { beforeEach, describe, expect, it, vi } from "vitest";

const selectInputsMock = vi.fn();
const createRunMock = vi.fn();
const backlogFindUniqueMock = vi.fn();
const activityCreateMock = vi.fn();

vi.mock("./backlog-selector", () => ({
  selectBacklogReviewCapacityWorkInputs: selectInputsMock,
}));

vi.mock("@/lib/tak/autonomous-work-run", () => ({
  createAutonomousWorkRun: createRunMock,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: {
      findUnique: backlogFindUniqueMock,
    },
    backlogItemActivity: {
      create: activityCreateMock,
    },
  },
}));

describe("runBacklogReviewCapacityContinuity", () => {
  beforeEach(() => {
    selectInputsMock.mockReset();
    createRunMock.mockReset();
    backlogFindUniqueMock.mockReset();
    activityCreateMock.mockReset();
  });

  it("creates TaskRuns through AutonomousWorkRun and does not execute tools directly", async () => {
    selectInputsMock.mockResolvedValue({
      inputs: [
        {
          trigger: "capacity-continuity",
          userId: "principal-owner",
          agentId: "agent-capacity",
          routeContext: "/workspace/my-queue",
          title: "Review backlog item BI-123",
          objective: "Review backlog item BI-123 for safe next action.",
          prompt: "Review backlog item BI-123 for safe next action.",
          sourceRef: { kind: "backlog-item", id: "BI-123" },
          metadata: {
            cognitiveLoad: {
              dedupeKey: "capacity:backlog-review:BI-123",
            },
          },
        },
      ],
      rejections: [],
    });
    createRunMock.mockResolvedValue({
      id: "internal-task-run",
      taskRunId: "TR-CAP-12345678",
      contextId: null,
    });

    const { runBacklogReviewCapacityContinuity } = await import("./runner");

    await expect(
      runBacklogReviewCapacityContinuity({
        agentId: "agent-capacity",
        ownerPrincipalId: "principal-owner",
        resolvedTools: [{ name: "list_backlog_items" }],
      }),
    ).resolves.toEqual({
      started: [
        {
          id: "internal-task-run",
          taskRunId: "TR-CAP-12345678",
          contextId: null,
        },
      ],
      rejections: [],
      recordedRejectionCount: 0,
    });

    expect(createRunMock).toHaveBeenCalledTimes(1);
    expect(createRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "capacity-continuity",
        sourceRef: { kind: "backlog-item", id: "BI-123" },
      }),
    );
    expect(activityCreateMock).not.toHaveBeenCalled();
  });

  it("records backlog activity for rejected capacity candidates", async () => {
    selectInputsMock.mockResolvedValue({
      inputs: [],
      rejections: [
        {
          candidateId: "backlog-review:BI-123",
          sourceRef: { kind: "backlog-item", id: "BI-123" },
          rejection: {
            code: "forbidden_grant",
            reason:
              "Capacity continuity cannot start work that requires the release_gate_create grant.",
            details: { grant: "release_gate_create", toolName: "deploy_release" },
          },
        },
      ],
    });
    backlogFindUniqueMock.mockResolvedValue({ id: "internal-backlog-id" });
    activityCreateMock.mockResolvedValue({ id: "activity-id" });

    const { runBacklogReviewCapacityContinuity } = await import("./runner");

    const result = await runBacklogReviewCapacityContinuity({
      agentId: "agent-capacity",
      ownerPrincipalId: "principal-owner",
      resolvedTools: [{ name: "deploy_release" }],
    });

    expect(result).toMatchObject({
      started: [],
      recordedRejectionCount: 1,
      rejections: [
        {
          candidateId: "backlog-review:BI-123",
          rejection: { code: "forbidden_grant" },
        },
      ],
    });
    expect(createRunMock).not.toHaveBeenCalled();
    expect(activityCreateMock).toHaveBeenCalledWith({
      data: {
        backlogItemId: "internal-backlog-id",
        kind: "capacity_continuity_rejected",
        summary:
          "Capacity continuity rejected backlog-review:BI-123: Capacity continuity cannot start work that requires the release_gate_create grant.",
        recordedByAgentId: "agent-capacity",
        payload: {
          candidateId: "backlog-review:BI-123",
          ownerPrincipalId: "principal-owner",
          rejection: {
            code: "forbidden_grant",
            reason:
              "Capacity continuity cannot start work that requires the release_gate_create grant.",
            details: { grant: "release_gate_create", toolName: "deploy_release" },
          },
          sourceRef: { kind: "backlog-item", id: "BI-123" },
        },
      },
    });
  });
});
