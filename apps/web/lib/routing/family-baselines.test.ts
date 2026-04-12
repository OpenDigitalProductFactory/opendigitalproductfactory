import { describe, expect, it } from "vitest";
import { getBaselineForModel, type FamilyBaseline } from "./family-baselines";

describe("getBaselineForModel", () => {
  it("matches claude-sonnet models", () => {
    const baseline = getBaselineForModel("claude-sonnet-4-5");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(88);
    expect(baseline!.confidence).toBe("medium");
  });

  it("matches claude-haiku models", () => {
    const baseline = getBaselineForModel("claude-3-5-haiku-20241022");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(65);
  });

  it("matches OpenRouter namespaced models", () => {
    const baseline = getBaselineForModel("anthropic/claude-sonnet-4-5");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(88);
  });

  it("matches gpt-4o but not gpt-4o-mini", () => {
    const full = getBaselineForModel("gpt-4o");
    const mini = getBaselineForModel("gpt-4o-mini");
    expect(full!.scores.reasoning).toBe(88);
    expect(mini!.scores.reasoning).toBe(68);
  });

  it("matches llama models by size", () => {
    const big = getBaselineForModel("llama-3.1-70b-instruct");
    const small = getBaselineForModel("llama-3.1-8b-instruct");
    expect(big!.scores.reasoning).toBeGreaterThan(small!.scores.reasoning);
  });

  it("returns null for unknown models", () => {
    const baseline = getBaselineForModel("totally-unknown-model-v1");
    expect(baseline).toBeNull();
  });

  it("does not false-match reasoning model regex on generic IDs", () => {
    const baseline = getBaselineForModel("proto1-7b");
    // Should NOT match the o1- pattern
    expect(baseline?.scores.reasoning).not.toBe(95);
  });

  it("matches Gemma 4 models", () => {
    const baseline = getBaselineForModel("ai/gemma4");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(62);
    expect(baseline!.scores.toolFidelity).toBe(55);
  });

  it("matches Gemma 4 with Ollama-style tags", () => {
    const baseline = getBaselineForModel("gemma4:27b");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(62);
  });

  it("matches Gemma 3 27B specifically", () => {
    const baseline = getBaselineForModel("gemma3:27b");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(58);
  });

  it("matches generic Gemma 3 at lower scores", () => {
    const baseline = getBaselineForModel("gemma3:4b");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(45);
  });

  it("matches Qwen 3 30B", () => {
    const baseline = getBaselineForModel("qwen3:30b");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(72);
  });

  it("matches generic Qwen 3", () => {
    const baseline = getBaselineForModel("qwen3:8b");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(55);
  });

  it("matches phi-4", () => {
    const baseline = getBaselineForModel("phi4");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(60);
  });

  it("matches Llama 3.3", () => {
    const baseline = getBaselineForModel("llama-3.3-70b-instruct");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(65);
  });
});
