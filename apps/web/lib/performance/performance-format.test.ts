import { describe, expect, it } from "vitest";

import {
  chartMetricValue,
  formatComparisonDelta,
  formatComparisonMagnitude,
  formatMetricValue,
} from "./performance-format";

describe("performance metric formatting", () => {
  it("formats business units consistently", () => {
    expect(formatMetricValue(0.125, "percent")).toBe("12.5%");
    expect(formatMetricValue(75, "duration")).toBe("1h 15m");
    expect(formatMetricValue(null, "count")).toBe("Not available");
    expect(formatComparisonDelta(0.25)).toBe("+25%");
    expect(formatComparisonMagnitude(-0.25)).toBe("25%");
  });

  it("scales ratio-based chart values to human percentages", () => {
    expect(chartMetricValue(0.25, "rate")).toBe(25);
    expect(chartMetricValue(75, "duration")).toBe(75);
  });
});
