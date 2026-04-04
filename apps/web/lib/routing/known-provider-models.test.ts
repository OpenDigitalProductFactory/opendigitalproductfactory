import { describe, expect, it } from "vitest";
import { KNOWN_PROVIDER_MODELS } from "./known-provider-models";

describe("KNOWN_PROVIDER_MODELS", () => {
  it("keeps gpt-5-codex active by default", () => {
    const gpt5Codex = KNOWN_PROVIDER_MODELS.codex.find((model) => model.modelId === "gpt-5-codex");
    expect(gpt5Codex?.defaultStatus).toBe("active");
  });

  it("keeps codex-mini-latest out of the default live routing pool", () => {
    const codexMini = KNOWN_PROVIDER_MODELS.codex.find((model) => model.modelId === "codex-mini-latest");
    expect(codexMini?.defaultStatus).toBe("disabled");
  });

  it("restores chatgpt subscription models as active defaults once responses routing is available", () => {
    const chatgpt = KNOWN_PROVIDER_MODELS.chatgpt.find((model) => model.modelId === "gpt-5.4");
    expect(chatgpt?.defaultStatus).toBe("active");
  });
});
