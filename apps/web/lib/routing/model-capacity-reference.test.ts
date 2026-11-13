import { describe, expect, it } from "vitest";
import { openAIAdapter } from "./adapter-openai";
import { referenceCodexTransportCapacity } from "./model-capacity-reference";

describe("Codex transport capacity reference (BI-F0ECD797)", () => {
  it("returns researched capacity for a Codex-served slug", () => {
    expect(referenceCodexTransportCapacity("gpt-6.1-sol")).toEqual({ maxOutputTokens: 128_000, maxContextTokens: 272_000 });
    expect(referenceCodexTransportCapacity("gpt-6.1-terra")).toEqual({ maxOutputTokens: 128_000, maxContextTokens: 500_000 });
  });

  it("never guesses: unresearched, app-only and prototype keys stay unknown", () => {
    for (const id of ["gpt-6.1-sol-wm", "gpt-5-6-thinking", "gpt-7", "", null, undefined, "toString", "__proto__"]) {
      expect(referenceCodexTransportCapacity(id)).toBeNull();
    }
  });

  it("gives Codex-catalog models the capacity activity admission requires", () => {
    const card = openAIAdapter.extractModelCard("gpt-6.1-sol", { id: "gpt-6.1-sol", model: "gpt-6.1-sol", source: "codex_cli_model_list" });
    expect(card.maxOutputTokens).toBe(128_000);
    expect(card.maxInputTokens).toBe(272_000);
  });

  it("leaves consumer-catalog and unresearched models without invented capacity", () => {
    const consumer = openAIAdapter.extractModelCard("gpt-6.1-sol", { id: "gpt-6.1-sol", source: "chatgpt_backend_discovery", max_tokens: 262_144 });
    expect(consumer.maxOutputTokens).toBeNull();
    expect(consumer.maxInputTokens).toBe(262_144);
    const unknown = openAIAdapter.extractModelCard("gpt-7-preview", { id: "gpt-7-preview", source: "codex_cli_model_list" });
    expect(unknown.maxOutputTokens).toBeNull();
    expect(unknown.maxInputTokens).toBeNull();
  });
});
