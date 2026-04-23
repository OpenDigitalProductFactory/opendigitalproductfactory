// apps/web/lib/auto-discover.test.ts
import { describe, it, expect } from "vitest";
import { KNOWN_PROVIDER_MODELS } from "@/lib/routing/known-provider-models";

describe("KNOWN_PROVIDER_MODELS catalog", () => {
  it("has entries for non-discoverable providers", () => {
    expect(KNOWN_PROVIDER_MODELS.codex).toBeDefined();
    expect(KNOWN_PROVIDER_MODELS.codex.length).toBeGreaterThan(0);
    expect(KNOWN_PROVIDER_MODELS.chatgpt).toBeDefined();
    expect(KNOWN_PROVIDER_MODELS.chatgpt.length).toBeGreaterThan(0);
    expect(KNOWN_PROVIDER_MODELS["anthropic-sub"]).toBeDefined();
    expect(KNOWN_PROVIDER_MODELS["anthropic-sub"].length).toBeGreaterThan(0);
  });

  it("does not have entries for live-discoverable direct providers", () => {
    expect(KNOWN_PROVIDER_MODELS["anthropic"]).toBeUndefined();
    expect(KNOWN_PROVIDER_MODELS["openai"]).toBeUndefined();
    expect(KNOWN_PROVIDER_MODELS["gemini"]).toBeUndefined();
    expect(KNOWN_PROVIDER_MODELS["ollama"]).toBeUndefined();
  });

  it("codex catalog uses canonical code model class and includes GPT-5 Codex", () => {
    const codexModels = KNOWN_PROVIDER_MODELS.codex;
    const modelIds = codexModels.map((model) => model.modelId);

    expect(modelIds).toContain("codex-mini-latest");
    expect(modelIds).toContain("gpt-5.3-codex");

    for (const model of codexModels) {
      expect(model.modelClass).toBe("code");
      expect(model.capabilities.toolUse).toBe(true);
    }

    const codexMini = codexModels.find((model) => model.modelId === "codex-mini-latest");
    const gpt5Codex = codexModels.find((model) => model.modelId === "gpt-5.3-codex");

    expect(codexMini).toBeDefined();
    expect(gpt5Codex).toBeDefined();
    expect(gpt5Codex!.scores?.codegen).toBeGreaterThan(codexMini!.scores?.codegen ?? 0);
    expect(gpt5Codex!.scores?.reasoning).toBeGreaterThan(codexMini!.scores?.reasoning ?? 0);
  });

  it("chatgpt model matches the curated fallback catalog", () => {
    const gpt = KNOWN_PROVIDER_MODELS.chatgpt[0];
    expect(gpt.modelId).toBe("gpt-5.4");
    expect(gpt.modelClass).toBe("chat");
    expect(gpt.costTier).toBe("subscription");
    expect(gpt.capabilities.toolUse).toBe(false);
    expect(gpt.capabilities.imageInput).toBe(true);
    expect(gpt.scores?.reasoning).toBe(85);
    expect(gpt.scores?.codegen).toBe(90);
  });

  it("all models have required fields", () => {
    for (const [providerId, models] of Object.entries(KNOWN_PROVIDER_MODELS)) {
      for (const m of models) {
        expect(m.modelId, `${providerId}/${m.modelId} missing modelId`).toBeTruthy();
        expect(m.friendlyName, `${providerId}/${m.modelId} missing friendlyName`).toBeTruthy();
        expect(m.modelClass, `${providerId}/${m.modelId} missing modelClass`).toBeTruthy();
        expect(m.capabilities, `${providerId}/${m.modelId} missing capabilities`).toBeDefined();
        expect(m.inputModalities.length, `${providerId}/${m.modelId} empty inputModalities`).toBeGreaterThan(0);
        expect(m.outputModalities.length, `${providerId}/${m.modelId} empty outputModalities`).toBeGreaterThan(0);
      }
    }
  });
});
