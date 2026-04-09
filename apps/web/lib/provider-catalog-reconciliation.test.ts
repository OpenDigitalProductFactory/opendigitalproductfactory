import { describe, expect, it, vi } from "vitest";
import {
  collectProviderCatalogSignals,
  detectOpenAiModelDeprecation,
  formatCatalogSignalWarning,
  getProviderCatalogStrategy,
  parseOpenAiModelsIndex,
} from "./provider-catalog-reconciliation";

describe("provider catalog reconciliation", () => {
  it("classifies Codex as a known-catalog provider", () => {
    expect(getProviderCatalogStrategy("codex")).toBe("known_catalog");
    expect(getProviderCatalogStrategy("openai")).toBe("provider_api");
  });

  it("parses OpenAI model ids from the official models index html", () => {
    const html = `
      <a href="/api/docs/models/gpt-5.3-codex">GPT-5.3 Codex</a>
      <a href="/api/docs/models/gpt-5.4">GPT-5.4</a>
      <a href="/api/docs/models/codex-mini-latest">Codex Mini</a>
    `;
    const parsed = parseOpenAiModelsIndex(html);
    expect(parsed.map((candidate) => candidate.modelId)).toEqual([
      "gpt-5.3-codex",
      "gpt-5.4",
      "codex-mini-latest",
    ]);
  });

  it("detects deprecation markers near a model entry", () => {
    const html = `codex-mini-latest <span>Deprecated</span>`;
    expect(detectOpenAiModelDeprecation(html, "codex-mini-latest")).toBe(true);
  });

  it("reports new official Codex candidates not yet in the known catalog", async () => {
    const html = `
      <a href="/api/docs/models/gpt-5.3-codex">GPT-5.3 Codex</a>
      <a href="/api/docs/models/gpt-5.4">GPT-5.4</a>
      <a href="/api/docs/models/codex-mini-latest">Codex Mini</a>
    `;
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
    });

    const signal = await collectProviderCatalogSignals("codex", fetchImpl as unknown as typeof fetch);

    expect(signal.newCandidates.map((candidate) => candidate.modelId)).toContain("gpt-5.3-codex");
    expect(formatCatalogSignalWarning(signal)).toContain("gpt-5.3-codex");
  });
});
