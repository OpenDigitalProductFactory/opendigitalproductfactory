import { describe, it, expect } from "vitest";
import { classifyHttpError, InferenceError } from "./ai-inference";

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

describe("classifyHttpError", () => {
  it("classifies HTTP 529 as provider overload", () => {
    const err = classifyHttpError(
      529,
      "anthropic-sub",
      "API Error: 529 Overloaded. This is a server-side issue, usually temporary.",
    );

    expect(err.code).toBe("overloaded");
    expect(err.statusCode).toBe(529);
    expect(err.message).toContain("Overloaded");
  });

  it("classifies overloaded provider text as overload even when status is generic", () => {
    const err = classifyHttpError(
      503,
      "anthropic-sub",
      "API Error: 529 Overloaded. If it persists, check status.claude.com.",
    );

    expect(err.code).toBe("overloaded");
    expect(err.statusCode).toBe(503);
  });
});

// Note: callProvider itself requires DB + HTTP mocking which is complex.
// The core logic is tested via ai-provider-priority.test.ts integration tests.
// Format construction correctness is verified by the existing profiling tests
// (same provider-specific branching logic was extracted from callProviderForProfiling).
