import { describe, expect, it } from "vitest";
import { resolveBacklogTarget, buildBacklogItemData, severityToPriority, isDuplicate, escalatePriorityForOccurrences } from "./process-observer-triage";
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

describe("escalatePriorityForOccurrences", () => {
  it("keeps a one-off at its base priority", () => {
    expect(escalatePriorityForOccurrences(4, 1)).toBe(4);
    expect(escalatePriorityForOccurrences(4, 2)).toBe(4);
  });
  it("climbs toward 1 as the tally grows", () => {
    expect(escalatePriorityForOccurrences(4, 3)).toBe(3);
    expect(escalatePriorityForOccurrences(4, 8)).toBe(2);
    expect(escalatePriorityForOccurrences(4, 20)).toBe(1);
  });
  it("never lowers urgency below the existing severity-based priority", () => {
    expect(escalatePriorityForOccurrences(1, 50)).toBe(1); // critical stays 1
    expect(escalatePriorityForOccurrences(2, 1)).toBe(2); // high never drops to 4 on a one-off
  });
  it("defaults a null/zero base to lowest (4), then escalates from the tally", () => {
    expect(escalatePriorityForOccurrences(null, 1)).toBe(4);
    expect(escalatePriorityForOccurrences(undefined, 8)).toBe(2);
    expect(escalatePriorityForOccurrences(0, 20)).toBe(1);
  });
  it("clamps to >=1 for very high tallies", () => {
    expect(escalatePriorityForOccurrences(4, 1000)).toBe(1);
  });
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
  it("creates item with workType=bug, source=automated-detection", () => {
    const d = buildBacklogItemData(finding, "t1", "p1");
    // Process observer is an automated detector; every finding is bug-class.
    expect(d.source).toBe("automated-detection");
    expect(d.workType).toBe("bug");
    expect(d.itemId).toMatch(/^BI-OBS-/);
    expect(d.priority).toBe(2);
  });
});

describe("isDuplicate", () => {
  it("matches exact", () => expect(isDuplicate("MCP tool failed", ["MCP tool failed"])).toBe(true));
  it("matches substring", () => expect(isDuplicate("MCP tool failed", ["MCP tool failed in conv"])).toBe(true));
  it("rejects unrelated", () => expect(isDuplicate("MCP tool failed", ["Provider quota"])).toBe(false));
});
