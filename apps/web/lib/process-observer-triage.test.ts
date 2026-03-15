import { describe, expect, it } from "vitest";
import { resolveBacklogTarget, buildBacklogItemData, severityToPriority, isDuplicate } from "./process-observer-triage";
import type { ObservationFinding } from "./process-observer";

const finding: ObservationFinding = {
  type: "tool_failure", severity: "high", title: "MCP tool execution failed",
  description: "Tool failed", rootCause: null, sentiment: "neutral",
  sourceMessageIds: ["m1"], suggestedAction: "Fix it",
};

describe("severityToPriority", () => {
  it("maps critical to 1", () => expect(severityToPriority("critical")).toBe(1));
  it("maps high to 2", () => expect(severityToPriority("high")).toBe(2));
  it("maps medium to 3", () => expect(severityToPriority("medium")).toBe(3));
  it("maps low to 4", () => expect(severityToPriority("low")).toBe(4));
});

describe("resolveBacklogTarget", () => {
  it("returns product when available", () => {
    expect(resolveBacklogTarget({ digitalProductId: "p1", routeContext: "/build" }).digitalProductId).toBe("p1");
  });
  it("returns null for unknown", () => {
    expect(resolveBacklogTarget({ digitalProductId: null, routeContext: "/x" }).digitalProductId).toBeNull();
  });
});

describe("buildBacklogItemData", () => {
  it("creates item with observer source", () => {
    const d = buildBacklogItemData(finding, "t1", "p1");
    expect(d.source).toBe("process_observer");
    expect(d.itemId).toMatch(/^BI-OBS-/);
    expect(d.priority).toBe(2);
  });
});

describe("isDuplicate", () => {
  it("matches exact", () => expect(isDuplicate("MCP tool failed", ["MCP tool failed"])).toBe(true));
  it("matches substring", () => expect(isDuplicate("MCP tool failed", ["MCP tool failed in conv"])).toBe(true));
  it("rejects unrelated", () => expect(isDuplicate("MCP tool failed", ["Provider quota"])).toBe(false));
});
