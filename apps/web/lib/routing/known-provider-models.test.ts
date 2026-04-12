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

  // ── Anthropic subscription models ─────────────────────────────────────────

  it("has an anthropic-sub catalog entry", () => {
    expect(KNOWN_PROVIDER_MODELS["anthropic-sub"]).toBeDefined();
    expect(KNOWN_PROVIDER_MODELS["anthropic-sub"].length).toBeGreaterThanOrEqual(3);
  });

  it("lists Sonnet 4.6 as active with frontier scores", () => {
    const sonnet = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-sonnet-4-6",
    );
    expect(sonnet).toBeDefined();
    expect(sonnet!.defaultStatus).toBe("active");
    expect(sonnet!.qualityTier).toBe("frontier");
    expect(sonnet!.scores!.codegen).toBeGreaterThanOrEqual(90);
    expect(sonnet!.scores!.toolFidelity).toBeGreaterThanOrEqual(90);
    expect(sonnet!.scores!.reasoning).toBeGreaterThanOrEqual(90);
  });

  it("lists Opus 4.6 as active with frontier scores", () => {
    const opus = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-opus-4-6",
    );
    expect(opus).toBeDefined();
    expect(opus!.defaultStatus).toBe("active");
    expect(opus!.qualityTier).toBe("frontier");
    expect(opus!.scores!.codegen).toBeGreaterThanOrEqual(90);
  });

  it("lists Haiku 4.5 as active with strong-tier scores", () => {
    const haiku = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-haiku-4-5-20251001",
    );
    expect(haiku).toBeDefined();
    expect(haiku!.defaultStatus).toBe("active");
    expect(haiku!.qualityTier).toBe("strong");
  });

  it("retires Haiku 3 by default (empty via subscription OAuth)", () => {
    const haiku3 = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-3-haiku-20240307",
    );
    expect(haiku3).toBeDefined();
    expect(haiku3!.defaultStatus).toBe("retired");
  });

  it("ensures Sonnet scores exceed strong-tier minimum (routing threshold)", () => {
    const sonnet = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-sonnet-4-6",
    );
    const strongMins = TIER_MINIMUM_DIMENSIONS.strong;
    const scores = sonnet!.scores!;
    for (const [dim, min] of Object.entries(strongMins)) {
      const scoreKey = dim as keyof typeof scores;
      expect(scores[scoreKey]).toBeGreaterThanOrEqual(min);
    }
  });

  it("ensures Sonnet outranks Haiku on all routing dimensions", () => {
    const sonnet = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-sonnet-4-6",
    )!;
    const haiku = KNOWN_PROVIDER_MODELS["anthropic-sub"].find(
      (m) => m.modelId === "claude-haiku-4-5-20251001",
    )!;
    expect(sonnet.scores!.codegen).toBeGreaterThan(haiku.scores!.codegen);
    expect(sonnet.scores!.toolFidelity).toBeGreaterThan(haiku.scores!.toolFidelity);
    expect(sonnet.scores!.reasoning).toBeGreaterThan(haiku.scores!.reasoning);
  });
});
