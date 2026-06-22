import { describe, expect, it } from "vitest";
import { backlogItemOrigin, BACKLOG_ORIGIN_LABEL } from "./backlog-origin";

describe("backlogItemOrigin", () => {
  it("derives origin from the front-door itemId prefix", () => {
    expect(backlogItemOrigin({ itemId: "BI-IMP-4C7DAE57" })).toBe("improvement");
    expect(backlogItemOrigin({ itemId: "BI-CAP-12AB34CD" })).toBe("capability-need");
    expect(backlogItemOrigin({ itemId: "BI-PIR-AB12CD34" })).toBe("issue-report");
    expect(backlogItemOrigin({ itemId: "BI-SIG-99887766" })).toBe("signal");
  });

  it("prefix wins over source", () => {
    expect(backlogItemOrigin({ itemId: "BI-IMP-1", source: "automated-detection" }))
      .toBe("improvement");
  });

  it("falls back to the coarse intake source when there is no origin prefix", () => {
    expect(backlogItemOrigin({ itemId: "BI-9DCFE8E9", source: "automated-detection" }))
      .toBe("auto-detected");
    expect(backlogItemOrigin({ itemId: "BI-PORT-005", source: "user-request" }))
      .toBe("requested");
  });

  it("is unknown when neither prefix nor source resolves", () => {
    expect(backlogItemOrigin({ itemId: "BI-9DCFE8E9" })).toBe("unknown");
    expect(backlogItemOrigin({})).toBe("unknown");
  });

  it("every origin has a label", () => {
    for (const origin of ["improvement", "capability-need", "issue-report", "signal", "requested", "auto-detected", "unknown"] as const) {
      expect(BACKLOG_ORIGIN_LABEL[origin]).toBeTruthy();
    }
  });
});
