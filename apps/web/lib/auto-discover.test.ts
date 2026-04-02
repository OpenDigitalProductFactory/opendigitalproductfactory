// apps/web/lib/auto-discover.test.ts
import { describe, it, expect } from "vitest";
import { KNOWN_PROVIDER_MODELS } from "@/lib/routing/known-provider-models";

describe("KNOWN_PROVIDER_MODELS catalog", () => {
  it("has entries for non-discoverable providers", () => {
    expect(KNOWN_PROVIDER_MODELS.codex).toBeDefined();
    expect(KNOWN_PROVIDER_MODELS.codex.length).toBeGreaterThan(0);
    expect(KNOWN_PROVIDER_MODELS.chatgpt).toBeDefined();
    expect(KNOWN_PROVIDER_MODELS.chatgpt.length).toBeGreaterThan(0);
  });

  it("does not have entries for discoverable providers", () => {
    expect(KNOWN_PROVIDER_MODELS["anthropic"]).toBeUndefined();
    expect(KNOWN_PROVIDER_MODELS["anthropic-sub"]).toBeUndefined();
    expect(KNOWN_PROVIDER_MODELS["openai"]).toBeUndefined();
    expect(KNOWN_PROVIDER_MODELS["gemini"]).toBeUndefined();
    expect(KNOWN_PROVIDER_MODELS["ollama"]).toBeUndefined();
  });

  it("codex model matches seed.ts data", () => {
    const codex = KNOWN_PROVIDER_MODELS.codex[0];
    expect(codex.modelId).toBe("codex-mini-latest");
    expect(codex.modelClass).toBe("agent");
    expect(codex.costTier).toBe("$$");
    expect(codex.capabilities.toolUse).toBe(true);
    expect(codex.scores?.codegen).toBe(90);
    expect(codex.scores?.reasoning).toBe(70);
  });

  it("chatgpt model matches seed.ts data", () => {
    const gpt = KNOWN_PROVIDER_MODELS.chatgpt[0];
    expect(gpt.modelId).toBe("gpt-5.4");
    expect(gpt.modelClass).toBe("chat");
    expect(gpt.costTier).toBe("subscription");
    expect(gpt.capabilities.toolUse).toBe(true);
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
