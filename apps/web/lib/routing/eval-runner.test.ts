import { describe, expect, it } from "vitest";
import {
  computeNewScore,
  detectDrift,
  errorLooksLikeInfrastructure,
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

describe("errorLooksLikeInfrastructure (BI-INST-008 circuit breaker)", () => {
  // Real error strings observed during the 2026-05-23 cold-install
  // dogfood. Each of these incorrectly retired every local model
  // before the circuit breaker landed.
  it("classifies 'No eligible endpoints for task X' as infrastructure", () => {
    expect(errorLooksLikeInfrastructure(
      "Error: No eligible endpoints for task 'conversation': No active endpoint manifests found.",
    )).toBe(true);
  });
  it("classifies 'No active endpoint manifests' as infrastructure", () => {
    expect(errorLooksLikeInfrastructure(
      "No active endpoint manifests found. Configure at least one AI provider with a profiled model.",
    )).toBe(true);
  });
  it("classifies HTTP timeout as infrastructure", () => {
    expect(errorLooksLikeInfrastructure(
      "Network error calling local: The operation was aborted due to timeout",
    )).toBe(true);
  });
  it("classifies generic 'network error' as infrastructure", () => {
    expect(errorLooksLikeInfrastructure(
      "Network error calling local: fetch failed",
    )).toBe(true);
  });
  it("classifies ECONNREFUSED as infrastructure", () => {
    expect(errorLooksLikeInfrastructure(
      "FetchError: connect ECONNREFUSED 192.168.65.1:11434",
    )).toBe(true);
  });
  it("classifies ENOTFOUND as infrastructure", () => {
    expect(errorLooksLikeInfrastructure(
      "FetchError: getaddrinfo ENOTFOUND model-runner.docker.internal",
    )).toBe(true);
  });
  it("classifies Docker Model Runner not running as infrastructure", () => {
    expect(errorLooksLikeInfrastructure(
      "Docker Model Runner is not running. Please start it and try again.",
    )).toBe(true);
  });

  // Cases that should NOT match — genuine model-quality failures still retire.
  it("does NOT classify a JSON parse failure as infrastructure", () => {
    expect(errorLooksLikeInfrastructure(
      "Invalid JSON in tool call: unexpected token at position 12",
    )).toBe(false);
  });
  it("does NOT classify a schema validation failure as infrastructure", () => {
    expect(errorLooksLikeInfrastructure(
      "Tool call did not match required schema: missing field 'employeeId'",
    )).toBe(false);
  });
  it("does NOT classify model API 4xx as infrastructure (model-side rejection)", () => {
    // A 4xx from the model API is a model issue — wrong format, exceeded
    // context limit, content policy violation — model SHOULD be flagged.
    expect(errorLooksLikeInfrastructure(
      "Model returned 400: prompt exceeds context window",
    )).toBe(false);
  });
  it("returns false for null (no error)", () => {
    expect(errorLooksLikeInfrastructure(null)).toBe(false);
  });
  it("returns false for empty string", () => {
    expect(errorLooksLikeInfrastructure("")).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(errorLooksLikeInfrastructure("NETWORK ERROR")).toBe(true);
    expect(errorLooksLikeInfrastructure("Fetch Failed")).toBe(true);
  });
});
