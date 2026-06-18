import { describe, it, expect } from "vitest";
import { resolveSeedPrice, PRICE_BRACKETS } from "./model-pricing-brackets.js";

describe("resolveSeedPrice", () => {
  it.each([
    ["anthropic-sub", "claude-opus-4-8", 15, 75],
    ["anthropic-sub", "claude-sonnet-4-6", 3, 15],
    ["anthropic-sub", "claude-haiku-4-5", 1, 5],
    ["anthropic", "claude-3-5-haiku", 1, 5],
    ["openai", "gpt-5.3", 10, 40],
    ["openai", "gpt-4o", 5, 15],
    ["codex", "gpt-5.3-codex", 5, 20],
    ["local", "qwen3:8b", 0, 0],
    ["ollama", "llama3.3", 0, 0],
  ])("prices the existing %s/%s bracket unchanged", (provider, model, input, output) => {
    expect(resolveSeedPrice(provider, model)).toEqual({ inputPerMToken: input, outputPerMToken: output });
  });

  it.each([
    // BI-6F42465E: second-tier providers that were previously null-priced.
    ["deepseek", "deepseek-chat", 0.14, 0.28],
    ["deepseek", "deepseek-reasoner", 0.14, 0.28],
    ["deepseek", "deepseek-v4-pro", 0.435, 0.87],
    ["groq", "llama-3.1-8b-instant", 0.05, 0.08],
    ["groq", "llama-3.3-70b-versatile", 0.59, 0.79],
    ["mistral", "mistral-small-latest", 0.1, 0.3],
    ["mistral", "mistral-large-latest", 0.5, 1.5],
    ["xai", "grok-build-0.1", 1, 2],
    ["xai", "grok-4.3", 1.25, 2.5],
    ["together", "llama-3.3-70b-instruct-turbo", 1.04, 1.04],
    ["fireworks", "llama-v3p3-70b-instruct", 0.9, 0.9],
  ])("prices the newly-covered %s/%s bracket", (provider, model, input, output) => {
    expect(resolveSeedPrice(provider, model)).toEqual({ inputPerMToken: input, outputPerMToken: output });
  });

  it("returns null for unverified/unknown providers (e.g. cohere) so the seeder leaves them null", () => {
    expect(resolveSeedPrice("cohere", "command-r-plus")).toBeNull();
    expect(resolveSeedPrice("some-future-provider", "x")).toBeNull();
  });

  it("orders specific matchers before the provider flagship (mini/small/8b/build/pro win)", () => {
    // groq 8b must not be captured by the general groq 70b bracket.
    expect(resolveSeedPrice("groq", "llama-3.1-8b-instant")?.inputPerMToken).toBe(0.05);
    // mistral small must not be captured by mistral large.
    expect(resolveSeedPrice("mistral", "mistral-small-3")?.inputPerMToken).toBe(0.1);
  });

  it("every bracket carries a source for the audit trail", () => {
    for (const b of PRICE_BRACKETS) {
      expect(b.source.length).toBeGreaterThan(0);
    }
  });
});
