import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  taskRunUpdate: vi.fn(),
  busEmit: vi.fn(),
  busIsActive: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { update: mocks.taskRunUpdate },
  },
}));

vi.mock("@/lib/tak/agent-event-bus", () => ({
  agentEventBus: {
    emit: mocks.busEmit,
    isActive: mocks.busIsActive,
  },
}));

import { pushThreadProgress } from "./thread-progress";

describe("pushThreadProgress", () => {
  beforeEach(() => {
    mocks.taskRunUpdate.mockReset();
    mocks.busEmit.mockReset();
    mocks.busIsActive.mockReset();
    mocks.taskRunUpdate.mockResolvedValue({});
  });

  it("persists the event to TaskRun.progressPayload", async () => {
    mocks.busIsActive.mockReturnValue(false);
    await pushThreadProgress("thread-1", "run-1", {
      type: "brand:extract.progress",
      taskRunId: "run-1",
      stage: "scraping",
      message: "Reading site",
      percent: 10,
    });

    expect(mocks.taskRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskRunId: "run-1" },
        data: expect.objectContaining({
          progressPayload: expect.objectContaining({
            type: "brand:extract.progress",
            stage: "scraping",
          }),
        }),
      }),
    );
  });

  it("emits to agentEventBus when thread is active in-process", async () => {
    mocks.busIsActive.mockReturnValue(true);
    const event = {
      type: "brand:extract.progress" as const,
      taskRunId: "run-1",
      stage: "merging",
      message: "Merging",
      percent: 50,
    };
    await pushThreadProgress("thread-1", "run-1", event);

    expect(mocks.busEmit.mock.calls).toEqual([
      ["thread-1", event],
      [
        "thread-1",
        {
          type: "task:status",
          taskId: "run-1",
          contextId: "thread-1",
          state: "working",
          sourceEvent: "brand:extract.progress",
          message: "Merging",
          progress: {
            stage: "merging",
            percent: 50,
          },
        },
      ],
    ]);
  });

  it("does NOT emit to bus when thread is not active (cross-process worker case)", async () => {
    mocks.busIsActive.mockReturnValue(false);
    await pushThreadProgress("thread-1", "run-1", {
      type: "brand:extract.progress",
      taskRunId: "run-1",
      stage: "scraping",
      message: "Reading site",
      percent: 10,
    });

    expect(mocks.busEmit).not.toHaveBeenCalled();
    expect(mocks.taskRunUpdate).toHaveBeenCalled();
  });

  it("swallows DB errors so extraction does not abort on progress-write failure", async () => {
    mocks.busIsActive.mockReturnValue(true);
    mocks.taskRunUpdate.mockRejectedValue(new Error("DB offline"));

    await expect(
      pushThreadProgress("thread-1", "run-1", {
        type: "brand:extract.progress",
        taskRunId: "run-1",
        stage: "scraping",
        message: "Reading site",
        percent: 10,
      }),
    ).resolves.toBeUndefined();

    // Bus emit still attempted
    expect(mocks.busEmit).toHaveBeenCalled();
  });
});
