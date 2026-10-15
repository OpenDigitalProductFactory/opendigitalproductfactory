// The four standing shapes BI-EBF0F6EE widened reach their rooms only by
// rebind: each 1.0.0 is retained, and 1.0.0 -> 1.1.0 is a widening, so the
// owner's rebind must carry a rationale (BI-CB5C0DCE, GPP §2.1.1).

import { describe, expect, it } from "vitest";

import { diffWorkShapeBinding } from "./work-shape-binding-diff";
import { getWorkShape, getWorkShapeVersion, readWorkShapeDefinitionContract } from "./work-shapes";

const BUMPED = ["pull-request-flow-watch", "contributor-intake-watch", "vendor-renewal-watch", "payables-watch"];

describe.each(BUMPED)("%s", (key) => {
  it("keeps 1.0.0 resolvable and classifies the move to 1.1.0 as a widening", () => {
    const current = getWorkShape(key)!;
    const prior = getWorkShapeVersion(key, "1.0.0");
    expect(current.version).toBe("1.1.0");
    expect(prior).not.toBeNull();
    const diff = diffWorkShapeBinding(readWorkShapeDefinitionContract(prior!), readWorkShapeDefinitionContract(current));
    expect(diff.classification).toBe("widening");
    expect(diff.changes.some((row) => row.kind === "tool-added")).toBe(true);
  });
});
