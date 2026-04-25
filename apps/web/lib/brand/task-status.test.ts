import { describe, expect, it } from "vitest";
import { extractBrandExtractionStatusFromTaskResponse } from "./task-status";

describe("extractBrandExtractionStatusFromTaskResponse", () => {
  it("returns running status from a working task envelope", () => {
    const status = extractBrandExtractionStatusFromTaskResponse({
      task: {
        taskId: "TR-BRAND-123",
        state: "working",
        progressPayload: {
          type: "brand:extract.progress",
          taskRunId: "TR-BRAND-123",
          stage: "extract",
          message: "Reading source materials",
          percent: 40,
        },
      },
    });

    expect(status).toEqual({
      kind: "running",
      taskRunId: "TR-BRAND-123",
      stage: "extract",
      message: "Reading source materials",
      percent: 40,
    });
  });

  it("returns complete status from a completed task envelope", () => {
    const status = extractBrandExtractionStatusFromTaskResponse({
      task: {
        taskId: "TR-BRAND-123",
        state: "completed",
        progressPayload: {
          type: "brand:extract.complete",
          taskRunId: "TR-BRAND-123",
          summary: "Extracted your brand.",
        },
      },
    });

    expect(status).toEqual({
      kind: "complete",
      taskRunId: "TR-BRAND-123",
      summary: "Extracted your brand.",
    });
  });

  it("returns failed status from a failed task envelope", () => {
    const status = extractBrandExtractionStatusFromTaskResponse({
      task: {
        taskId: "TR-BRAND-123",
        state: "failed",
        progressPayload: {
          type: "brand:extract.failed",
          taskRunId: "TR-BRAND-123",
          error: "Fetch failed",
        },
      },
    });

    expect(status).toEqual({
      kind: "failed",
      taskRunId: "TR-BRAND-123",
      error: "Fetch failed",
    });
  });
});
