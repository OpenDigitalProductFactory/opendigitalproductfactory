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
});
