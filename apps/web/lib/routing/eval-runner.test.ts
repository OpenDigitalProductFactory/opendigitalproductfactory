import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks for the runDimensionEval integration test. The pure-function tests in
// this file don't touch either module, so the mocks are inert for them.
const evalState = vi.hoisted(() => ({
  profileUpdates: [] as Array<Record<string, unknown>>,
  callCount: 0,
  errorMessage: "The operation was aborted due to timeout",
}));

vi.mock("@/lib/ai-inference", () => {
  class InferenceError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    InferenceError,
    callProvider: vi.fn(async () => {
      evalState.callCount++;
      throw new InferenceError(evalState.errorMessage, "network");
    }),
  };
});

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProfile: {
      findUnique: vi.fn(async () => ({ evalCount: 0, modelStatus: "active" })),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        evalState.profileUpdates.push(args.data);
        return {};
      }),
    },
    modelProvider: {
      findUnique: vi.fn(async () => ({ authMethod: "none", name: "Local" })),
    },
    endpointTestRun: {
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
  },
}));

import {
  computeNewScore,
  detectDrift,
  errorLooksLikeInfrastructure,
  errorLooksLikeConfigGap,
  errorEndsEvalCycle,
  runDimensionEval,
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

describe("errorLooksLikeConfigGap (credential/setup circuit breaker)", () => {
  // The exact error that flooded the portal logs and wrongly retired xAI's
  // grok models: a provider with no API key configured.
  it("classifies a missing credential as a config gap (not model quality)", () => {
    expect(errorLooksLikeConfigGap("No credential configured")).toBe(true);
  });
  it("matches the CLI-adapter 'No credential for' phrasing", () => {
    expect(
      errorLooksLikeConfigGap('No credential for "xai". Configure via Admin.'),
    ).toBe(true);
  });
  it("matches a rotated-key decrypt failure", () => {
    expect(
      errorLooksLikeConfigGap("All encrypted fields failed to decrypt"),
    ).toBe(true);
  });
  it("does NOT match a genuine model-quality / not-found failure (still retires)", () => {
    expect(errorLooksLikeConfigGap("Model not found on local")).toBe(false);
    expect(errorLooksLikeConfigGap("schema validation failed")).toBe(false);
  });
  it("returns false for null / empty", () => {
    expect(errorLooksLikeConfigGap(null)).toBe(false);
    expect(errorLooksLikeConfigGap("")).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(errorLooksLikeConfigGap("NO CREDENTIAL CONFIGURED")).toBe(true);
  });
});

describe("errorEndsEvalCycle (whole-endpoint short-circuit predicate)", () => {
  it("is true for infrastructure failures", () => {
    expect(errorEndsEvalCycle("The operation was aborted due to timeout")).toBe(true);
    expect(errorEndsEvalCycle("fetch failed")).toBe(true);
  });
  it("is true for config/credential gaps", () => {
    expect(errorEndsEvalCycle("No credential configured")).toBe(true);
    expect(errorEndsEvalCycle("All encrypted fields failed to decrypt")).toBe(true);
  });
  it("is false for genuine model-quality failures (those still get scored/retired)", () => {
    expect(errorEndsEvalCycle("schema validation failed")).toBe(false);
    expect(errorEndsEvalCycle("Model not found on local")).toBe(false);
    expect(errorEndsEvalCycle(null)).toBe(false);
  });
});

describe("runDimensionEval — whole-endpoint short-circuit", () => {
  beforeEach(() => {
    evalState.profileUpdates.length = 0;
    evalState.callCount = 0;
    evalState.errorMessage = "The operation was aborted due to timeout";
  });

  it("stops after the first timed-out probe instead of grinding every test", async () => {
    await runDimensionEval("local", "docker.io/ai/qwen3-coder:latest", "test");

    // A single failing probe ends the whole run — not ~30 sequential 60s
    // timeouts across every dimension. This is the wall-clock + log-flood fix
    // for an unreachable/slow local Docker Model Runner.
    expect(evalState.callCount).toBe(1);
  });

  it("does NOT retire the model on an infrastructure timeout", async () => {
    await runDimensionEval("local", "docker.io/ai/qwen3-coder:latest", "test");

    // A timeout is a broken probe path, not a model-quality failure — retiring
    // would strand a working-but-slow model.
    const retired = evalState.profileUpdates.some(
      (u) => u.modelStatus === "retired",
    );
    expect(retired).toBe(false);
  });

  it("also short-circuits on a config gap (rotated/missing key fails every test identically)", async () => {
    // Regression for the gap found in live verification: a credential error is
    // a whole-endpoint failure too, but only infrastructure errors used to
    // short-circuit — so an uncredentialed/rotated provider flooded ~24 lines.
    evalState.errorMessage = "No credential configured";

    await runDimensionEval("gemini", "gemma-3-1b-it", "test");

    expect(evalState.callCount).toBe(1);
    const retired = evalState.profileUpdates.some(
      (u) => u.modelStatus === "retired",
    );
    expect(retired).toBe(false);
  });
});
