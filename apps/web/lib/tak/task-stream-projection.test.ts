import { describe, expect, it } from "vitest";

import {
  projectAgentEventToTaskEvents,
  projectPersistedTaskProgressEvents,
} from "./task-stream-projection";

describe("projectAgentEventToTaskEvents", () => {
  it("projects brand extraction progress into canonical task status events", () => {
    expect(
      projectAgentEventToTaskEvents(
        {
          type: "brand:extract.progress",
          taskRunId: "TR-123",
          stage: "scraping",
          message: "Reading source materials",
          percent: 15,
        },
        { contextId: "ctx-1" },
      ),
    ).toEqual([
      {
        type: "task:status",
        taskId: "TR-123",
        contextId: "ctx-1",
        state: "working",
        message: "Reading source materials",
        progress: {
          stage: "scraping",
          percent: 15,
        },
        sourceEvent: "brand:extract.progress",
      },
    ]);
  });

  it("projects terminal extraction events into canonical task status events", () => {
    expect(
      projectAgentEventToTaskEvents(
        {
          type: "brand:extract.complete",
          taskRunId: "TR-123",
          summary: "Extraction complete",
        },
        { contextId: "ctx-1" },
      ),
    ).toEqual([
      {
        type: "task:status",
        taskId: "TR-123",
        contextId: "ctx-1",
        state: "completed",
        message: "Extraction complete",
        sourceEvent: "brand:extract.complete",
      },
    ]);

    expect(
      projectAgentEventToTaskEvents(
        {
          type: "brand:extract.failed",
          taskRunId: "TR-123",
          error: "Source unavailable",
        },
        { contextId: "ctx-1" },
      ),
    ).toEqual([
      {
        type: "task:status",
        taskId: "TR-123",
        contextId: "ctx-1",
        state: "failed",
        message: "Source unavailable",
        sourceEvent: "brand:extract.failed",
      },
    ]);
  });

  it("projects legacy persisted progress payloads that store an events array", () => {
    expect(
      projectPersistedTaskProgressEvents(
        {
          events: [
            {
              type: "brand:extract.progress",
              taskRunId: "TR-123",
              stage: "scraping",
              message: "Reading source materials",
              percent: 15,
            },
            {
              type: "brand:extract.complete",
              taskRunId: "TR-123",
              summary: "Extraction complete",
            },
          ],
        },
        { contextId: "ctx-1" },
      ),
    ).toEqual([
      {
        type: "brand:extract.progress",
        taskRunId: "TR-123",
        stage: "scraping",
        message: "Reading source materials",
        percent: 15,
      },
      {
        type: "task:status",
        taskId: "TR-123",
        contextId: "ctx-1",
        state: "working",
        message: "Reading source materials",
        progress: {
          stage: "scraping",
          percent: 15,
        },
        sourceEvent: "brand:extract.progress",
      },
      {
        type: "brand:extract.complete",
        taskRunId: "TR-123",
        summary: "Extraction complete",
      },
      {
        type: "task:status",
        taskId: "TR-123",
        contextId: "ctx-1",
        state: "completed",
        message: "Extraction complete",
        sourceEvent: "brand:extract.complete",
      },
    ]);
  });
});
