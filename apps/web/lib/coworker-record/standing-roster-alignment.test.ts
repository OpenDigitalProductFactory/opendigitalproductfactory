import { describe, expect, it } from "vitest";

import { STANDING_SHAPE_REQUIRED_AGENT } from "@dpf/storefront-templates";
import { STANDING_SHAPES } from "@/lib/work-management/standing-operations-shapes";

function firstAgentSlug(shape: (typeof STANDING_SHAPES)[string]): string | null {
  for (const stage of shape.stages) {
    const ref = stage.accountablePrincipalRef;
    if (ref.startsWith("agent:")) return ref.slice("agent:".length);
  }
  return null;
}

describe("standing roster frozen map", () => {
  it("matches the first agent stage of every standing operations shape", () => {
    const shapeKeys = Object.keys(STANDING_SHAPES).sort();
    const mapKeys = Object.keys(STANDING_SHAPE_REQUIRED_AGENT).sort();
    expect(mapKeys).toEqual(shapeKeys);
    for (const key of shapeKeys) {
      expect(STANDING_SHAPE_REQUIRED_AGENT[key], key).toBe(firstAgentSlug(STANDING_SHAPES[key]));
    }
  });
});
