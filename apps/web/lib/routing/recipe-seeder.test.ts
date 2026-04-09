/**
 * EP-INF-005b: Recipe seeder tests (TDD).
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

import { describe, expect, it } from "vitest";
import { buildSeedRecipe } from "./recipe-seeder";
import { EMPTY_CAPABILITIES } from "./model-card-types";
import type { ModelCardCapabilities } from "./model-card-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function caps(overrides: Partial<ModelCardCapabilities> = {}): ModelCardCapabilities {
  return { ...EMPTY_CAPABILITIES, ...overrides };
}

function baseModelCard(overrides: Partial<{ capabilities: ModelCardCapabilities; maxOutputTokens: number | null; modelClass: string }> = {}) {
  return {
    capabilities: caps(),
    maxOutputTokens: 8192 as number | null,
    modelClass: "chat",
    ...overrides,
  };
}

function baseContract(overrides: Partial<{
  estimatedOutputTokens: number;
  reasoningDepth: string;
  budgetClass: string;
  requiresTools: boolean;
  requiresStrictSchema: boolean;
  requiresStreaming: boolean;
}> = {}) {
  return {
    estimatedOutputTokens: 2000,
    reasoningDepth: "minimal",
    budgetClass: "balanced",
    requiresTools: false,
    requiresStrictSchema: false,
    requiresStreaming: false,
    ...overrides,
  };
}

// ── Anthropic provider settings ──────────────────────────────────────────────

describe("buildSeedRecipe – Anthropic", () => {
  it("high reasoning + thinking capable → thinking enabled with 8192 budget, max_tokens includes budget", () => {
    const result = buildSeedRecipe(
      "anthropic",
      "claude-sonnet-4-5",
      "claude-sonnet",
      baseModelCard({ capabilities: caps({ thinking: true }) }),
      baseContract({ reasoningDepth: "high" }),
    );

    expect(result.providerSettings).toHaveProperty("thinking");
    expect(result.providerSettings.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    // max_tokens = deriveMaxTokens(2000, 8192) + budget = 4000 + 8192 = 12192
    expect(result.providerSettings.max_tokens).toBe(4000 + 8192);
  });

  it("medium + adaptive thinking → thinking type adaptive", () => {
    const result = buildSeedRecipe(
      "anthropic",
      "claude-sonnet-4-5",
      "claude-sonnet",
      baseModelCard({ capabilities: caps({ thinking: true, adaptiveThinking: true }) }),
      baseContract({ reasoningDepth: "medium" }),
    );

    expect(result.providerSettings.thinking).toEqual({ type: "adaptive" });
  });

  it("medium + thinking (no adaptive) → thinking enabled with 4096 budget", () => {
    const result = buildSeedRecipe(
      "anthropic",
      "claude-sonnet-4-5",
      "claude-sonnet",
      baseModelCard({ capabilities: caps({ thinking: true, adaptiveThinking: false }) }),
      baseContract({ reasoningDepth: "medium" }),
    );

    expect(result.providerSettings.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
    // max_tokens = deriveMaxTokens(2000, 8192) + budget = 4000 + 4096 = 8096
    expect(result.providerSettings.max_tokens).toBe(4000 + 4096);
  });

  it("minimal reasoning → no thinking in providerSettings", () => {
    const result = buildSeedRecipe(
      "anthropic",
      "claude-sonnet-4-5",
      "claude-sonnet",
      baseModelCard({ capabilities: caps({ thinking: true }) }),
      baseContract({ reasoningDepth: "minimal" }),
    );

    expect(result.providerSettings).not.toHaveProperty("thinking");
  });

  it("matches anthropic- prefixed providers", () => {
    const result = buildSeedRecipe(
      "anthropic-vertex",
      "claude-sonnet-4-5",
      "claude-sonnet",
      baseModelCard({ capabilities: caps({ thinking: true }) }),
      baseContract({ reasoningDepth: "high" }),
    );

    expect(result.providerSettings.thinking).toEqual({ type: "enabled", budget_tokens: 8192 });
    expect(result.providerSettings.max_tokens).toBe(4000 + 8192);
  });
});

// ── OpenAI reasoning ─────────────────────────────────────────────────────────

describe("buildSeedRecipe – OpenAI reasoning", () => {
  it("medium → reasoning_effort medium", () => {
    const result = buildSeedRecipe(
      "openai",
      "o3",
      "o3",
      baseModelCard({ modelClass: "reasoning" }),
      baseContract({ reasoningDepth: "medium" }),
    );

    expect(result.providerSettings).toHaveProperty("reasoning_effort", "medium");
  });

  it("high → reasoning_effort high", () => {
    const result = buildSeedRecipe(
      "openai",
      "o3",
      "o3",
      baseModelCard({ modelClass: "reasoning" }),
      baseContract({ reasoningDepth: "high" }),
    );

    expect(result.providerSettings).toHaveProperty("reasoning_effort", "high");
  });
});

// ── OpenAI chat ──────────────────────────────────────────────────────────────

describe("buildSeedRecipe – OpenAI chat", () => {
  it("minimize_cost → temperature 0.3", () => {
    const result = buildSeedRecipe(
      "openai",
      "gpt-4o",
      "gpt-4o",
      baseModelCard({ modelClass: "chat" }),
      baseContract({ budgetClass: "minimize_cost" }),
    );

    expect(result.providerSettings).toHaveProperty("temperature", 0.3);
  });

  it("balanced → temperature 0.7", () => {
    const result = buildSeedRecipe(
      "openai",
      "gpt-4o",
      "gpt-4o",
      baseModelCard({ modelClass: "chat" }),
      baseContract({ budgetClass: "balanced" }),
    );

    expect(result.providerSettings).toHaveProperty("temperature", 0.7);
  });

  it("quality_first → temperature 1.0", () => {
    const result = buildSeedRecipe(
      "openai",
      "gpt-4o",
      "gpt-4o",
      baseModelCard({ modelClass: "chat" }),
      baseContract({ budgetClass: "quality_first" }),
    );

    expect(result.providerSettings).toHaveProperty("temperature", 1.0);
  });
});

// ── Ollama ────────────────────────────────────────────────────────────────────

describe("buildSeedRecipe – Ollama", () => {
  it("sets keep_alive -1", () => {
    const result = buildSeedRecipe(
      "ollama",
      "llama3.1",
      "llama",
      baseModelCard(),
      baseContract(),
    );

    expect(result.providerSettings).toHaveProperty("keep_alive", -1);
  });
});

// ── Unknown provider ─────────────────────────────────────────────────────────

describe("buildSeedRecipe – unknown provider", () => {
  it("just max_tokens", () => {
    const result = buildSeedRecipe(
      "some-unknown",
      "some-model",
      "some-family",
      baseModelCard(),
      baseContract({ estimatedOutputTokens: 2000 }),
    );

    expect(result.providerSettings).toEqual({ max_tokens: 4000 });
  });
});

describe("buildSeedRecipe – responses-backed providers", () => {
  it("routes codex models through the responses adapter", () => {
    const result = buildSeedRecipe(
      "codex",
      "gpt-5.3-codex",
      "sync.code-gen",
      baseModelCard({ modelClass: "code" }),
      baseContract(),
    );

    expect(result.executionAdapter).toBe("responses");
  });

  it("routes chatgpt subscription models through the responses adapter", () => {
    const result = buildSeedRecipe(
      "chatgpt",
      "gpt-5.4",
      "sync.reasoning",
      baseModelCard({ modelClass: "chat" }),
      baseContract(),
    );

    expect(result.executionAdapter).toBe("responses");
  });
});

// ── Tool policy ──────────────────────────────────────────────────────────────

describe("buildSeedRecipe – toolPolicy", () => {
  it("tool contract → toolChoice auto", () => {
    const result = buildSeedRecipe(
      "openai",
      "gpt-4o",
      "gpt-4o",
      baseModelCard(),
      baseContract({ requiresTools: true }),
    );

    expect(result.toolPolicy).toEqual({
      toolChoice: "auto",
      allowParallelToolCalls: true,
    });
  });

  it("no tools → toolChoice undefined", () => {
    const result = buildSeedRecipe(
      "openai",
      "gpt-4o",
      "gpt-4o",
      baseModelCard(),
      baseContract({ requiresTools: false }),
    );

    expect(result.toolPolicy).toEqual({
      toolChoice: undefined,
      allowParallelToolCalls: true,
    });
  });
});

// ── Response policy ──────────────────────────────────────────────────────────

describe("buildSeedRecipe – responsePolicy", () => {
  it("schema contract → strictSchema true", () => {
    const result = buildSeedRecipe(
      "openai",
      "gpt-4o",
      "gpt-4o",
      baseModelCard(),
      baseContract({ requiresStrictSchema: true }),
    );

    expect(result.responsePolicy).toEqual({
      strictSchema: true,
      stream: false,
    });
  });

  it("streaming contract → stream true", () => {
    const result = buildSeedRecipe(
      "openai",
      "gpt-4o",
      "gpt-4o",
      baseModelCard(),
      baseContract({ requiresStreaming: true }),
    );

    expect(result.responsePolicy).toEqual({
      strictSchema: false,
      stream: true,
    });
  });
});

// ── providerTools in seed output (EP-INF-008b) ──────────────────────────────

describe("buildSeedRecipe – providerTools", () => {
  it("Gemini + codeExecution + sync.code-gen → providerTools in providerSettings", () => {
    const result = buildSeedRecipe(
      "gemini",
      "gemini-2.0-flash",
      "sync.code-gen",
      baseModelCard({ capabilities: caps({ codeExecution: true }) }),
      baseContract(),
    );
    expect(result.providerSettings.providerTools).toEqual([{ code_execution: {} }]);
  });

  it("Gemini + webSearch + sync.web-search → grounding tool in providerSettings", () => {
    const result = buildSeedRecipe(
      "gemini",
      "gemini-2.0-flash",
      "sync.web-search",
      baseModelCard({ capabilities: caps({ webSearch: true }) }),
      baseContract(),
    );
    expect(result.providerSettings.providerTools).toBeDefined();
    expect((result.providerSettings.providerTools as any[])[0]).toHaveProperty("google_search_retrieval");
  });

  it("Anthropic + computerUse + sync.tool-action → computer tool in providerSettings", () => {
    const result = buildSeedRecipe(
      "anthropic",
      "claude-sonnet-4-5",
      "sync.tool-action",
      baseModelCard({ capabilities: caps({ computerUse: true }) }),
      baseContract(),
    );
    expect(result.providerSettings.providerTools).toBeDefined();
    expect((result.providerSettings.providerTools as any[])[0]).toHaveProperty("type", "computer_20241022");
  });

  it("no matching capability → no providerTools key", () => {
    const result = buildSeedRecipe(
      "openai",
      "gpt-4o",
      "sync.code-gen",
      baseModelCard(),
      baseContract(),
    );
    expect(result.providerSettings.providerTools).toBeUndefined();
  });
});

// ── maxTokens derivation ─────────────────────────────────────────────────────

describe("buildSeedRecipe – maxTokens derivation", () => {
  it("estimated 500 × 2 = 1000, but floor is 1024 → 1024", () => {
    const result = buildSeedRecipe(
      "some-unknown",
      "model",
      "family",
      baseModelCard({ maxOutputTokens: 8192 }),
      baseContract({ estimatedOutputTokens: 500 }),
    );

    expect(result.providerSettings).toEqual({ max_tokens: 1024 });
  });

  it("estimated 5000 × 2 = 10000, model cap 8192 → 8192", () => {
    const result = buildSeedRecipe(
      "some-unknown",
      "model",
      "family",
      baseModelCard({ maxOutputTokens: 8192 }),
      baseContract({ estimatedOutputTokens: 5000 }),
    );

    expect(result.providerSettings).toEqual({ max_tokens: 8192 });
  });

  it("model cap null → estimated × 2 capped at 4096", () => {
    const result = buildSeedRecipe(
      "some-unknown",
      "model",
      "family",
      baseModelCard({ maxOutputTokens: null }),
      baseContract({ estimatedOutputTokens: 5000 }),
    );

    expect(result.providerSettings).toEqual({ max_tokens: 4096 });
  });
});
