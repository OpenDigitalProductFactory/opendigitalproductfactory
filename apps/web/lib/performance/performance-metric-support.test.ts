import { describe, expect, it } from "vitest";

import {
  PERFORMANCE_METRIC_ARCHETYPES,
  archetypeHasPerformanceMetrics,
} from "./performance-metric-support";

describe("archetypeHasPerformanceMetrics", () => {
  it("is true for every archetype the engine has a source loader for", () => {
    for (const archetypeId of PERFORMANCE_METRIC_ARCHETYPES) {
      expect(archetypeHasPerformanceMetrics(archetypeId)).toBe(true);
    }
  });

  it("is false for an archetype with no source loader", () => {
    expect(archetypeHasPerformanceMetrics("software-platform")).toBe(false);
    expect(archetypeHasPerformanceMetrics("field-service")).toBe(false);
  });

  it("includes restaurant as the currently-registered loader", () => {
    expect(PERFORMANCE_METRIC_ARCHETYPES).toContain("restaurant");
  });
});
