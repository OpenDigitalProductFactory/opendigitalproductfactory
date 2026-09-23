// apps/web/lib/routing/effort-expression.test.ts
//
// BI-DBAFEC10. The guard that matters: reasoningDepth used to be computed and
// then discarded for every provider except Anthropic and OpenAI. Gemini never got
// a thinking budget at all.
import { describe, expect, it } from "vitest";
import { expressEffort, proportionalBudget, resolveEffort } from "./effort-expression";
import { EMPTY_CAPABILITIES, type ModelCardCapabilities } from "./model-card-types";

const thinkingCaps: ModelCardCapabilities = { ...EMPTY_CAPABILITIES, thinking: true };
const adaptiveCaps: ModelCardCapabilities = { ...EMPTY_CAPABILITIES, thinking: true, adaptiveThinking: true };

function decide(depth: "minimal" | "low" | "medium" | "high", inputTokens = 8000, caps = thinkingCaps) {
  return resolveEffort({
    reasoningDepth: depth,
    estimatedInputTokens: inputTokens,
    maxOutputTokens: 64000,
    capabilities: caps,
  });
}

describe("resolveEffort", () => {
  it("spends nothing at minimal or low depth", () => {
    expect(decide("minimal")).toMatchObject({ level: "none", budgetTokens: null });
    expect(decide("low")).toMatchObject({ level: "none", budgetTokens: null });
  });

  it("scales the budget with the work rather than using a constant", () => {
    // The superseded design gave a one-line classification and a 40k-token
    // review the same 8192 budget.
    const small = decide("high", 2000).budgetTokens!;
    const large = decide("high", 40000).budgetTokens!;
    expect(large).toBeGreaterThan(small);
  });

  it("never asks for more thinking than the model can return", () => {
    expect(proportionalBudget("high", 200000, 4096)).toBeLessThanOrEqual(4096);
  });

  it("keeps a floor so a tiny prompt still gets usable thinking room", () => {
    expect(decide("high", 10).budgetTokens).toBeGreaterThanOrEqual(1024);
  });

  it("prefers adaptive thinking at medium depth when the model manages its own budget", () => {
    expect(decide("medium", 8000, adaptiveCaps)).toMatchObject({ adaptive: true, budgetTokens: null });
  });
});

describe("expressEffort — one decision, each provider's dialect", () => {
  const high = decide("high");

  it("Anthropic: extended thinking, and max_tokens must cover the budget", () => {
    const e = expressEffort("anthropic", high, thinkingCaps);
    expect(e.settings).toMatchObject({ thinking: { type: "enabled", budget_tokens: high.budgetTokens } });
    expect(e.extraMaxTokens).toBe(high.budgetTokens);
    expect(e.thinking).toBe(true);
  });

  it("Anthropic adaptive: the model owns the budget, so no extra output tokens", () => {
    const e = expressEffort("anthropic", decide("medium", 8000, adaptiveCaps), adaptiveCaps);
    expect(e.settings).toEqual({ thinking: { type: "adaptive" } });
    expect(e.extraMaxTokens).toBe(0);
  });

  it("OpenAI reasoning: reasoning_effort", () => {
    const e = expressEffort("openai", high, EMPTY_CAPABILITIES, { modelClass: "reasoning" });
    expect(e.settings).toEqual({ reasoning_effort: "high" });
  });

  it("Gemini: thinkingConfig.thinkingBudget — previously absent from the whole tree", () => {
    const e = expressEffort("gemini", high, thinkingCaps);
    expect(e.settings).toEqual({ thinkingConfig: { thinkingBudget: high.budgetTokens } });
    expect(e.effortUnexpressed).toBe(false);
  });

  // BI-D9F13BEA: Gemini spends thinking tokens inside maxOutputTokens, exactly as
  // Anthropic spends budget_tokens inside max_tokens. Without the budget on top,
  // thinking consumed the answer's ceiling: Build Studio plans came back empty
  // (38 times on the dev install) or cut off mid-array, and builds stalled in plan.
  it("Gemini: the thinking budget is added on top of the answer's output ceiling", () => {
    expect(expressEffort("gemini", high, thinkingCaps).extraMaxTokens).toBe(high.budgetTokens);
  });

  it("OpenRouter: reasoning.effort", () => {
    expect(expressEffort("openrouter", high, thinkingCaps).settings).toEqual({
      reasoning: { effort: "high" },
    });
  });

  it("DeepSeek / Grok / GLM: the provider-native reasoning field", () => {
    for (const id of ["deepseek", "xai-grok", "zai-glm"]) {
      expect(expressEffort(id, high, thinkingCaps).settings).toEqual({ reasoning_effort: "high" });
    }
  });

  it("local native: Ollama's think toggle", () => {
    const e = expressEffort("local", high, thinkingCaps, { isLocalNative: true });
    expect(e.settings).toEqual({ think: true });
    expect(e.thinking).toBe(true);
  });

  it("records effortUnexpressed when a provider cannot say it, instead of going quiet", () => {
    const e = expressEffort("some-plain-provider", high, EMPTY_CAPABILITIES);
    expect(e.settings).toEqual({});
    expect(e.effortUnexpressed).toBe(true);
  });

  it("records effortUnexpressed when the model declares it will not accept the level", () => {
    const caps: ModelCardCapabilities = { ...thinkingCaps, effortLevels: ["low", "medium"] };
    expect(expressEffort("openai", high, caps, { modelClass: "reasoning" }).effortUnexpressed).toBe(true);
  });

  it("asks for nothing at all when the contract wants no effort", () => {
    const e = expressEffort("anthropic", decide("low"), thinkingCaps);
    expect(e).toMatchObject({ settings: {}, thinking: false, effortUnexpressed: false });
  });
});
