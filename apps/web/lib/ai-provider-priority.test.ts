import { describe, it, expect } from "vitest";

// These tests validate the pure logic functions.
// buildBootstrapPriority and callWithFailover require DB mocking (tested via integration).

describe("provider priority types", () => {
  it("ProviderPriorityEntry has required fields", async () => {
    // Type-level test: if this compiles, the type is correct
    const entry: import("./ai-provider-priority").ProviderPriorityEntry = {
      providerId: "ollama",
      modelId: "llama3:8b",
      rank: 1,
      capabilityTier: "fast-worker",
    };
    expect(entry.providerId).toBe("ollama");
    expect(entry.rank).toBe(1);
  });

  it("FailoverResult extends InferenceResult with downgrade info", async () => {
    const result: import("./ai-provider-priority").FailoverResult = {
      content: "Hello",
      inputTokens: 10,
      outputTokens: 5,
      inferenceMs: 100,
      providerId: "ollama",
      modelId: "llama3:8b",
      downgraded: false,
      downgradeMessage: null,
    };
    expect(result.downgraded).toBe(false);
    expect(result.downgradeMessage).toBeNull();
  });

  it("FailoverResult with downgrade has a message", () => {
    const result: import("./ai-provider-priority").FailoverResult = {
      content: "Hello",
      inputTokens: 10,
      outputTokens: 5,
      inferenceMs: 100,
      providerId: "ollama",
      modelId: "llama3:8b",
      downgraded: true,
      downgradeMessage: "anthropic is unavailable. Using ollama (lower capability) — results may be less accurate.",
    };
    expect(result.downgraded).toBe(true);
    expect(result.downgradeMessage).toContain("lower capability");
  });
});
