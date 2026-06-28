import { describe, expect, it } from "vitest";
import { KNOWN_PROVIDER_MODELS } from "./known-provider-models";
import { TIER_MINIMUM_DIMENSIONS } from "./quality-tiers";

describe("KNOWN_PROVIDER_MODELS", () => {
  it("keeps gpt-5.3-codex active by default", () => {
    const gpt5Codex = KNOWN_PROVIDER_MODELS.codex.find((model) => model.modelId === "gpt-5.3-codex");
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

  it("keeps xAI/Grok catalog-backed sync available for OAuth-only Build Studio connections", () => {
    expect(KNOWN_PROVIDER_MODELS.xai.map((model) => model.modelId)).toEqual(
      expect.arrayContaining(["grok-4.3", "grok-build-0.1"]),
    );

    const grokBuild = KNOWN_PROVIDER_MODELS.xai.find((model) => model.modelId === "grok-build-0.1");
    expect(grokBuild?.defaultStatus).toBe("active");
    expect(grokBuild?.modelClass).toBe("code");
    expect(grokBuild?.capabilities.toolUse).toBe(true);
  });

  it("adds GLM-5.2 catalog entries for Z.ai inference and OpenCode coding", () => {
    const glm = KNOWN_PROVIDER_MODELS.zai.find((model) => model.modelId === "glm-5.2");
    expect(glm).toBeDefined();
    expect(glm!.defaultStatus).toBe("active");
    expect(glm!.qualityTier).toBe("frontier");
    expect(glm!.modelClass).toBe("reasoning");
    expect(glm!.maxContextTokens).toBe(1_000_000);
    expect(glm!.capabilities.toolUse).toBe(true);
    expect(glm!.capabilities.structuredOutput).toBe(true);
    expect(glm!.scores!.reasoning).toBeGreaterThanOrEqual(90);
    expect(glm!.scores!.toolFidelity).toBeGreaterThanOrEqual(85);

    const coding = KNOWN_PROVIDER_MODELS["zai-coding"].find((model) => model.modelId === "glm-5.2");
    expect(coding).toBeDefined();
    expect(coding!.defaultStatus).toBe("active");
    expect(coding!.modelClass).toBe("code");
    expect(coding!.capabilities.toolUse).toBe(true);
    expect(coding!.scores!.codegen).toBeGreaterThanOrEqual(90);
  });

  // ── Anthropic subscription models ─────────────────────────────────────────

  it("has an anthropic-sub catalog entry", () => {
    expect(KNOWN_PROVIDER_MODELS["anthropic-sub"]).toBeDefined();
    expect(KNOWN_PROVIDER_MODELS["anthropic-sub"].length).toBeGreaterThanOrEqual(3);
  });

  it("lists Sonnet 4.6 as active with frontier reasoning and platform tool scores", () => {
    const sonnet = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-sonnet-4-6",
    );
    expect(sonnet).toBeDefined();
    expect(sonnet!.defaultStatus).toBe("active");
    expect(sonnet!.qualityTier).toBe("frontier");
    expect(sonnet!.scores!.codegen).toBeGreaterThanOrEqual(90);
    expect(sonnet!.scores!.toolFidelity).toBeGreaterThanOrEqual(90);
    expect(sonnet!.scores!.reasoning).toBeGreaterThanOrEqual(90);
    expect(sonnet!.capabilities.toolUse).toBe(true);
  });

  it("lists Opus 4.6 as active with frontier scores", () => {
    const opus = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-opus-4-6",
    );
    expect(opus).toBeDefined();
    expect(opus!.defaultStatus).toBe("active");
    expect(opus!.qualityTier).toBe("frontier");
    expect(opus!.scores!.codegen).toBeGreaterThanOrEqual(90);
    expect(opus!.scores!.toolFidelity).toBeGreaterThanOrEqual(90);
    expect(opus!.capabilities.toolUse).toBe(true);
  });

  it("lists Haiku 4.5 as active with strong-tier scores", () => {
    const haiku = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-haiku-4-5-20251001",
    );
    expect(haiku).toBeDefined();
    expect(haiku!.defaultStatus).toBe("active");
    expect(haiku!.qualityTier).toBe("strong");
    expect(haiku!.scores!.toolFidelity).toBeGreaterThanOrEqual(70);
    expect(haiku!.capabilities.toolUse).toBe(true);
  });

  it("retires Haiku 3 by default (empty via subscription OAuth)", () => {
    const haiku3 = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-3-haiku-20240307",
    );
    expect(haiku3).toBeDefined();
    expect(haiku3!.defaultStatus).toBe("retired");
    expect(haiku3!.capabilities.toolUse).toBe(false);
  });

  it("ensures Sonnet still exceeds strong-tier minimum on non-tool reasoning dimensions", () => {
    const sonnet = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-sonnet-4-6",
    );
    const strongMins = TIER_MINIMUM_DIMENSIONS.strong;
    const scores = sonnet!.scores!;
    for (const [dim, min] of Object.entries(strongMins)) {
      if (dim === "toolFidelity") continue;
      const scoreKey = dim as keyof typeof scores;
      expect(scores[scoreKey]).toBeGreaterThanOrEqual(min);
    }
  });

  it("keeps Sonnet ahead of Haiku on reasoning, code, and tool-use dimensions", () => {
    const sonnet = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-sonnet-4-6",
    )!;
    const haiku = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-haiku-4-5-20251001",
    )!;
    expect(sonnet.scores!.codegen).toBeGreaterThan(haiku.scores!.codegen);
    expect(sonnet.scores!.reasoning).toBeGreaterThan(haiku.scores!.reasoning);
    expect(sonnet.scores!.toolFidelity).toBeGreaterThan(haiku.scores!.toolFidelity);
    expect(haiku.scores!.toolFidelity).toBeGreaterThanOrEqual(70);
  });
});
