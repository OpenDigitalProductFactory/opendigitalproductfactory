import { describe, expect, it } from "vitest";
import {
  deriveBuildStudioCapability,
  SUGGESTED_PROVIDERS,
  type ActiveProviderModel,
} from "./build-studio-capability";

function model(overrides: Partial<ActiveProviderModel> = {}): ActiveProviderModel {
  return {
    providerId: "anthropic-sub",
    providerName: "Claude / Anthropic (OAuth Subscription)",
    modelId: "claude-sonnet-4-6",
    supportsToolUse: true,
    maxInputTokens: 200_000,
    ...overrides,
  };
}

describe("deriveBuildStudioCapability", () => {
  it("returns no_active_llm_providers when zero models passed", () => {
    const result = deriveBuildStudioCapability([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_active_llm_providers");
      expect(result.suggestedProviders).toEqual(SUGGESTED_PROVIDERS);
      expect(result.activeProviderNames).toEqual([]);
    }
  });

  it("returns only_local_provider_active when only Docker Model Runner has under-tier models", () => {
    const result = deriveBuildStudioCapability([
      model({
        providerId: "local",
        providerName: "Docker Model Runner (local)",
        modelId: "ai/magistral-small-3.2:latest",
        maxInputTokens: 128_000,
      }),
      model({
        providerId: "local",
        providerName: "Docker Model Runner (local)",
        modelId: "ai/gemma:latest",
        supportsToolUse: false,
        maxInputTokens: 8_192,
      }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("only_local_provider_active");
      expect(result.activeProviderNames).toEqual(["Docker Model Runner (local)"]);
    }
  });

  it("returns ok when Claude Sonnet 4.x is active", () => {
    const result = deriveBuildStudioCapability([model()]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.satisfyingProviderNames).toContain("Claude / Anthropic (OAuth Subscription)");
    }
  });

  it("returns ok when Gemini 2.5 Pro is active", () => {
    const result = deriveBuildStudioCapability([
      model({
        providerId: "gemini",
        providerName: "Google Gemini",
        modelId: "gemini-2.5-pro",
        maxInputTokens: 1_000_000,
      }),
    ]);
    expect(result.ok).toBe(true);
  });

  it("REJECTS even strong-tier local models — Build Studio requires a remote provider regardless of local model strength (operator directive 2026-05-23)", () => {
    const result = deriveBuildStudioCapability([
      model({
        providerId: "local",
        providerName: "Docker Model Runner (local)",
        modelId: "ai/qwen3:14B-Q6_K",
        maxInputTokens: 32_768,
      }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("only_local_provider_active");
    }
  });

  it("REJECTS docker.io-prefixed local model IDs (real shape from Docker Model Runner)", () => {
    const result = deriveBuildStudioCapability([
      model({
        providerId: "local",
        providerName: "Docker Model Runner (local)",
        modelId: "docker.io/ai/qwen3:14B-Q6_K",
        maxInputTokens: null,
      }),
    ]);
    expect(result.ok).toBe(false);
  });

  it("rejects strong-tier model when supportsToolUse is explicitly false", () => {
    const result = deriveBuildStudioCapability([model({ supportsToolUse: false })]);
    expect(result.ok).toBe(false);
  });

  it("rejects strong-tier model when context window is below the build-specialist floor", () => {
    const result = deriveBuildStudioCapability([model({ maxInputTokens: 16_000 })]);
    expect(result.ok).toBe(false);
  });

  it("treats null supportsToolUse as assumed-true so a freshly connected provider isn't blocked on discovery", () => {
    const result = deriveBuildStudioCapability([model({ supportsToolUse: null })]);
    expect(result.ok).toBe(true);
  });

  it("treats null maxInputTokens as assumed-sufficient so a freshly connected provider isn't blocked on discovery", () => {
    const result = deriveBuildStudioCapability([model({ maxInputTokens: null })]);
    expect(result.ok).toBe(true);
  });

  it("returns no_strong_tier_model_available when remotes are active but none qualify", () => {
    const result = deriveBuildStudioCapability([
      model({
        providerId: "anthropic",
        providerName: "Claude / Anthropic (API Key)",
        modelId: "claude-3-haiku",
        maxInputTokens: 200_000,
      }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_strong_tier_model_available");
    }
  });

  it("returns ok when at least one of several active models qualifies (mixed install)", () => {
    const result = deriveBuildStudioCapability([
      model({
        providerId: "local",
        providerName: "Docker Model Runner (local)",
        modelId: "ai/magistral-small-3.2:latest",
        maxInputTokens: 128_000,
      }),
      model({
        providerId: "anthropic-sub",
        providerName: "Claude / Anthropic (OAuth Subscription)",
        modelId: "claude-sonnet-4-6",
      }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.satisfyingProviderNames).toEqual(["Claude / Anthropic (OAuth Subscription)"]);
    }
  });
});
