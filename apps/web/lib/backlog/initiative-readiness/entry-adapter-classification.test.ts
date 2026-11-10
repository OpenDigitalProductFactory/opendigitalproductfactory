import { describe, expect, it } from "vitest";
import { projectBacklogItemReadiness } from "./entry-adapter";
import { item, transitionObject } from "./entry-adapter.test-fixtures";

describe("invalid work-type governance applicability", () => {
  it.each([" refactor ", "future-kind", ""])("keeps present invalid workType %j governed without a fallback profile", workType => {
    const projection = projectBacklogItemReadiness({
      item: { ...item, workType, activeBuildKind: "feature" }, activities: [],
      target: "completion", transitionObject, authorization: "pass", capsuleIdentity: "pass",
      evaluatedAt: "2026-11-02T00:00:00.000Z",
    });
    expect(projection.governed).toBe(true);
    expect(projection.decision.verdict).not.toBe("allowed");
    expect(projection.decision.unmet).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "CLASSIFICATION_REQUIRED" }),
    ]));
  });

  it("preserves absent legacy applicability without making it a passing decision", () => {
    const projection = projectBacklogItemReadiness({
      item: { ...item, workType: null, type: "legacy", source: "legacy", scopeKind: null }, activities: [],
      target: "completion", transitionObject, authorization: "pass", capsuleIdentity: "pass",
      evaluatedAt: "2026-11-02T00:00:00.000Z",
    });
    expect(projection.governed).toBe(false);
    expect(projection.decision.verdict).not.toBe("allowed");
  });
});
