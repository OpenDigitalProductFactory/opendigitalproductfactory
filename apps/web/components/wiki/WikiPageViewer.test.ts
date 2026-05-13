import { describe, expect, it } from "vitest";
import { getPrincipleDisplayWeight } from "./WikiPageViewer";

describe("getPrincipleDisplayWeight", () => {
  it("returns the explicit override when one is set", () => {
    expect(getPrincipleDisplayWeight("commandment", 0.85)).toBe(0.85);
    expect(getPrincipleDisplayWeight("core", 0.5)).toBe(0.5);
    expect(getPrincipleDisplayWeight("contextual", 0)).toBe(0);
  });

  it("returns the tier default when no override is set", () => {
    expect(getPrincipleDisplayWeight("commandment", null)).toBe(1.0);
    expect(getPrincipleDisplayWeight("core", null)).toBe(0.4);
    expect(getPrincipleDisplayWeight("contextual", null)).toBe(0.1);
  });

  it("returns the tier default when the override is undefined", () => {
    expect(getPrincipleDisplayWeight("commandment", undefined)).toBe(1.0);
  });

  it("returns null for unknown / untiered principles so callers fall back to a neutral display", () => {
    expect(getPrincipleDisplayWeight(null, null)).toBeNull();
    expect(getPrincipleDisplayWeight(undefined, null)).toBeNull();
    expect(getPrincipleDisplayWeight("imaginary_tier", null)).toBeNull();
  });

  it("still respects an explicit override even when the tier is unknown", () => {
    // An admin could legitimately want to weight a draft principle before
    // the tier is finalized. The override takes precedence over the tier
    // default lookup.
    expect(getPrincipleDisplayWeight("imaginary_tier", 0.25)).toBe(0.25);
    expect(getPrincipleDisplayWeight(null, 0.7)).toBe(0.7);
  });
});
