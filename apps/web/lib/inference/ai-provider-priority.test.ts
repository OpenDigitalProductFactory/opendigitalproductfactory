import { describe, it, expect } from "vitest";
import { resolveTaskPriority, type TaskAwarePriority, type ProviderPriorityEntry } from "./ai-provider-priority";

// These tests validate the pure logic functions.
// buildBootstrapPriority and callWithFailover require DB mocking (tested via integration).

describe("provider priority types", () => {
  it("NoAllowedProvidersForSensitivityError carries the blocked sensitivity", async () => {
    const err = new (await import("./ai-provider-priority")).NoAllowedProvidersForSensitivityError("restricted");
    expect(err.sensitivity).toBe("restricted");
    expect(err.name).toBe("NoAllowedProvidersForSensitivityError");
  });

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

// ─── Task-Aware Priority Tests ──────────────────────────────────────────────

describe("resolveTaskPriority", () => {
  const SAMPLE_ENTRIES: ProviderPriorityEntry[] = [
    { providerId: "anthropic", modelId: "claude-sonnet-4-20250514", rank: 1, capabilityTier: "deep-thinker" },
    { providerId: "ollama", modelId: "qwen3:8b", rank: 2, capabilityTier: "fast-worker" },
  ];

  const CODE_ENTRIES: ProviderPriorityEntry[] = [
    { providerId: "anthropic", modelId: "claude-sonnet-4-20250514", rank: 1, capabilityTier: "deep-thinker" },
    { providerId: "openai", modelId: "gpt-4o", rank: 2, capabilityTier: "deep-thinker" },
  ];

  it("returns conversation entries for 'conversation' task from task-keyed object", () => {
    const stored: TaskAwarePriority = {
      conversation: SAMPLE_ENTRIES,
      code_generation: CODE_ENTRIES,
    };
    expect(resolveTaskPriority(stored, "conversation")).toEqual(SAMPLE_ENTRIES);
  });

  it("returns code_generation entries for 'code_generation' task", () => {
    const stored: TaskAwarePriority = {
      conversation: SAMPLE_ENTRIES,
      code_generation: CODE_ENTRIES,
    };
    expect(resolveTaskPriority(stored, "code_generation")).toEqual(CODE_ENTRIES);
  });

  it("falls back to conversation for unknown task key", () => {
    const stored: TaskAwarePriority = {
      conversation: SAMPLE_ENTRIES,
      code_generation: CODE_ENTRIES,
    };
    expect(resolveTaskPriority(stored, "analysis")).toEqual(SAMPLE_ENTRIES);
  });

  it("treats flat array as conversation (backward compat)", () => {
    expect(resolveTaskPriority(SAMPLE_ENTRIES, "conversation")).toEqual(SAMPLE_ENTRIES);
  });

  it("treats flat array as conversation even when code_generation requested", () => {
    expect(resolveTaskPriority(SAMPLE_ENTRIES, "code_generation")).toEqual(SAMPLE_ENTRIES);
  });
});
