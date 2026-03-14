import { describe, it, expect } from "vitest";
import { InferenceError } from "./ai-inference";

describe("InferenceError", () => {
  it("has correct code and providerId", () => {
    const err = new InferenceError("test", "network", "ollama");
    expect(err.code).toBe("network");
    expect(err.providerId).toBe("ollama");
    expect(err.name).toBe("InferenceError");
  });

  it("includes statusCode when provided", () => {
    const err = new InferenceError("rate limited", "rate_limit", "openai", 429);
    expect(err.statusCode).toBe(429);
  });
});

// Note: callProvider itself requires DB + HTTP mocking which is complex.
// The core logic is tested via ai-provider-priority.test.ts integration tests.
// Format construction correctness is verified by the existing profiling tests
// (same provider-specific branching logic was extracted from callProviderForProfiling).
