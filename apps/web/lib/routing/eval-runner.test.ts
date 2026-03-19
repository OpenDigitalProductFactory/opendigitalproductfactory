import { describe, expect, it } from "vitest";
import {
  computeNewScore,
  detectDrift,
  type DriftResult,
} from "./eval-runner";

describe("computeNewScore", () => {
  it("uses raw score on first eval (evalCount=0)", () => {
    expect(computeNewScore(85, 50, 0)).toBe(85);
  });
  it("uses weighted rolling average on subsequent evals", () => {
    // 0.7 * 85 + 0.3 * 70 = 59.5 + 21 = 80.5 → 81
    expect(computeNewScore(85, 70, 5)).toBe(81);
  });
  it("clamps to 0-100 range", () => {
    expect(computeNewScore(150, 90, 3)).toBeLessThanOrEqual(100);
    expect(computeNewScore(-10, 20, 3)).toBeGreaterThanOrEqual(0);
  });
});

describe("detectDrift", () => {
  it("returns no drift for small changes", () => {
    const result = detectDrift(80, 70);
    expect(result.severity).toBe("none");
  });
  it("returns warning for >15 point drop", () => {
    const result = detectDrift(55, 80);
    expect(result.severity).toBe("warning");
  });
  it("returns severe for >25 point drop", () => {
    const result = detectDrift(50, 80);
    expect(result.severity).toBe("severe");
  });
  it("returns no drift for improvements", () => {
    const result = detectDrift(90, 70);
    expect(result.severity).toBe("none");
  });
});
