import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  taskRunFindUnique: vi.fn(),
  taskMessageCreate: vi.fn(),
  taskArtifactCreate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { findUnique: mocks.taskRunFindUnique },
    taskMessage: { create: mocks.taskMessageCreate },
    taskArtifact: { create: mocks.taskArtifactCreate },
  },
}));

import { createTaskArtifact, createTaskMessage } from "./task-records";

describe("task-records", () => {
  beforeEach(() => {
    mocks.taskRunFindUnique.mockReset();
    mocks.taskMessageCreate.mockReset();
    mocks.taskArtifactCreate.mockReset();
    mocks.taskRunFindUnique.mockResolvedValue({ id: "task-row-1", contextId: "thread-1" });
    mocks.taskMessageCreate.mockResolvedValue({});
    mocks.taskArtifactCreate.mockResolvedValue({});
  });

  it("persists task messages with normalized metadata", async () => {
    await createTaskMessage({
      taskRunId: "run-1",
      contextId: "thread-1",
      role: "system",
      messageType: "progress",
      content: "Reading brand source",
      metadata: {
        stage: "scraping",
        percent: 10,
      },
    });

    expect(mocks.taskMessageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskRunId: "task-row-1",
        contextId: "thread-1",
        role: "system",
        parts: [
          expect.objectContaining({
            type: "progress",
            text: "Reading brand source",
          }),
        ],
        metadata: expect.objectContaining({
          stage: "scraping",
          percent: 10,
        }),
        referenceTaskIds: [],
      }),
    });
  });

  it("persists task artifacts with JSON payloads", async () => {
    await createTaskArtifact({
      taskRunId: "run-1",
      artifactType: "design-system",
      name: "Extracted brand design system",
      mimeType: "application/json",
      summary: "Primary color and typography extracted from source materials.",
      content: {
        palette: { primary: "#336699" },
      },
      metadata: {
        sourceCount: 2,
      },
    });

    expect(mocks.taskArtifactCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskRunId: "task-row-1",
        name: "Extracted brand design system",
        description: "Primary color and typography extracted from source materials.",
        parts: [
          expect.objectContaining({
            type: "design-system",
            mimeType: "application/json",
            data: expect.objectContaining({
              palette: expect.objectContaining({ primary: "#336699" }),
            }),
          }),
        ],
        metadata: expect.objectContaining({
          sourceCount: 2,
        }),
      }),
    });
  });
});
