import { describe, expect, it } from "vitest";
import { coerceBrandExtractionEvent } from "./extraction-events";

describe("coerceBrandExtractionEvent", () => {
  it("ignores stale events from a different task when a specific extraction is active", () => {
    const event = coerceBrandExtractionEvent(
      {
        type: "brand:extract.complete",
        taskRunId: "TR-BRAND-OLD",
        summary: "Old completion",
      },
      "TR-BRAND-NEW",
    );

    expect(event).toBeNull();
  });

  it("accepts matching task events", () => {
    const event = coerceBrandExtractionEvent(
      {
        type: "brand:extract.complete",
        taskRunId: "TR-BRAND-NEW",
        summary: "New completion",
      },
      "TR-BRAND-NEW",
    );

    expect(event).toEqual({
      type: "brand:extract.complete",
      taskRunId: "TR-BRAND-NEW",
      summary: "New completion",
    });
  });

  it("accepts the first task event when reattaching without a known task id", () => {
    const event = coerceBrandExtractionEvent(
      {
        type: "brand:extract.progress",
        taskRunId: "TR-BRAND-RUNNING",
        stage: "extract",
        message: "Collecting signals",
        percent: 25,
      },
      "",
    );

    expect(event).toEqual({
      type: "brand:extract.progress",
      taskRunId: "TR-BRAND-RUNNING",
      stage: "extract",
      message: "Collecting signals",
      percent: 25,
    });
  });
});
