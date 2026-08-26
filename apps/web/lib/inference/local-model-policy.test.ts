import { describe, it, expect } from "vitest";
import {
  isEmbeddingModelId,
  classifyLocalModelRole,
  recommendGenerationModel,
  recommendGenerationModelForHost,
  computeMemoryBudgetGb,
  estimateModelVramGb,
  recommendKeepGenerationModel,
  detectLocalModelOverCommit,
  normaliseModelId,
  MAX_CONCURRENT_GENERATION_MODELS,
  RECOMMENDED_BUILD_CONTEXT_TOKENS,
  MAX_LOCAL_CONTEXT_TOKENS,
  clampServedContextTokens,
  recommendServedContextTokens,
  LOCAL_MODEL_TIERS,
} from "./local-model-policy";

describe("fresh-install model provenance (BI-957122B4)", () => {
  it("only recommends models from Docker's curated ai/ namespace", () => {
    expect(LOCAL_MODEL_TIERS.every((tier) => tier.model.startsWith("ai/"))).toBe(true);
  });
});

describe("classifyLocalModelRole / isEmbeddingModelId", () => {
  it("classifies embedders", () => {
    expect(isEmbeddingModelId("ai/nomic-embed-text-v1.5")).toBe(true);
    expect(isEmbeddingModelId("bge-large")).toBe(true);
    expect(classifyLocalModelRole("nomic-embed-text-v1.5")).toBe("embedding");
  });
  it("classifies generation models", () => {
    expect(isEmbeddingModelId("qwen3-coder")).toBe(false);
    expect(isEmbeddingModelId("gemma4:12B")).toBe(false);
    expect(classifyLocalModelRole("ai/qwen3:8B-Q4_K_M")).toBe("generation");
  });
});

describe("recommendGenerationModel (discrete, headroom-aware)", () => {
  it("null VRAM (undetectable) → broadly-compatible 8B default", () => {
    expect(recommendGenerationModel(null)).toBe("ai/qwen3:8B-Q4_K_M");
  });
  it("0 VRAM (CPU-only host) → smallest tier", () => {
    expect(recommendGenerationModel(0)).toBe("ai/qwen3:4B-UD-Q4_K_XL");
  });
  it("reserves headroom so a recommended model never fills the card", () => {
    // 24 GB card → Qwen3-Coder (16+5=21 fits), and nothing may select a model
    // whose weights+headroom exceed the card:
    // that over-commit at build context is the bug this headroom rule exists for.
    expect(recommendGenerationModel(24)).toBe("ai/qwen3-coder");
    expect(recommendGenerationModel(27)).toBe("ai/qwen3-coder");
    expect(recommendGenerationModel(22)).toBe("ai/qwen3-coder");
    expect(recommendGenerationModel(21)).toBe("ai/qwen3-coder");
    expect(recommendGenerationModel(17)).toBe("ai/qwen3:14B-Q6_K");
    expect(recommendGenerationModel(12)).toBe("ai/qwen3:8B-Q4_K_M");
    expect(recommendGenerationModel(11)).toBe("ai/qwen3:8B-Q4_K_M");
    // budget GPUs land on a model that actually fits, not one that over-commits
    expect(recommendGenerationModel(8)).toBe("ai/qwen3:4B-UD-Q4_K_XL");
    expect(recommendGenerationModel(6)).toBe("ai/qwen3:4B-UD-Q4_K_XL");
  });
});

describe("recommendGenerationModelForHost (architecture-aware) + computeMemoryBudgetGb", () => {
  it("discrete card uses VRAM directly → the 4090 lands on the curated coder", () => {
    expect(recommendGenerationModelForHost({ architecture: "discrete", vramGb: 24 })).toBe("ai/qwen3-coder");
    expect(computeMemoryBudgetGb({ architecture: "discrete", vramGb: 24 })).toBe(24);
  });
  it("unified Apple Silicon runs a far larger model than the same GB of discrete VRAM", () => {
    // 128 GB unified Mac → 80B MoE (128 * 0.75 = 96 budget; 48+5 fits).
    expect(recommendGenerationModelForHost({ architecture: "unified", totalRamGb: 128 })).toBe("ai/qwen3-coder-next");
    // 32 GB Mac → 24 budget → the same curated coder as a 24 GB card.
    expect(recommendGenerationModelForHost({ architecture: "unified", totalRamGb: 32 })).toBe("ai/qwen3-coder");
    expect(recommendGenerationModelForHost({ architecture: "unified", totalRamGb: 16 })).toBe("ai/qwen3:8B-Q4_K_M");
  });
  it("cpu-only reserves more system RAM for the OS", () => {
    expect(computeMemoryBudgetGb({ architecture: "cpu", totalRamGb: 16 })).toBe(8);
    expect(recommendGenerationModelForHost({ architecture: "cpu", totalRamGb: 16 })).toBe("ai/qwen3:4B-UD-Q4_K_XL");
  });
  it("a budget 8–12 GB discrete GPU never over-commits", () => {
    expect(recommendGenerationModelForHost({ architecture: "discrete", vramGb: 12 })).toBe("ai/qwen3:8B-Q4_K_M");
    expect(recommendGenerationModelForHost({ architecture: "discrete", vramGb: 8 })).toBe("ai/qwen3:4B-UD-Q4_K_XL");
  });
});

describe("RECOMMENDED_BUILD_CONTEXT_TOKENS", () => {
  it("clears the OpenCode build floor (22k) so the auto-set context never truncates builds", () => {
    expect(RECOMMENDED_BUILD_CONTEXT_TOKENS).toBeGreaterThanOrEqual(22_000);
  });
});

describe("clampServedContextTokens", () => {
  it("floors below-build values up to the build floor", () => {
    expect(clampServedContextTokens(4_096)).toBe(RECOMMENDED_BUILD_CONTEXT_TOKENS);
    expect(clampServedContextTokens(0)).toBe(RECOMMENDED_BUILD_CONTEXT_TOKENS);
  });
  it("caps above-ceiling values at MAX_LOCAL_CONTEXT_TOKENS", () => {
    expect(clampServedContextTokens(999_999)).toBe(MAX_LOCAL_CONTEXT_TOKENS);
  });
  it("passes in-band values through", () => {
    expect(clampServedContextTokens(49_152)).toBe(49_152);
  });
  it("falls back to the floor on non-finite input", () => {
    expect(clampServedContextTokens(NaN)).toBe(RECOMMENDED_BUILD_CONTEXT_TOKENS);
  });
});

describe("recommendServedContextTokens (host-aware)", () => {
  it("scales a big unified Mac up to the ceiling", () => {
    // 128 GB unified → 96 GB budget; minus 22 GB weights + 5 GB headroom = 69 GB
    // KV budget → ~690k tokens, clamped to the ceiling.
    const host = { architecture: "unified" as const, totalRamGb: 128 };
    expect(recommendServedContextTokens(host, 22)).toBe(MAX_LOCAL_CONTEXT_TOKENS);
  });
  it("keeps a 24 GB discrete card near the build floor", () => {
    // 24 GB VRAM − 16 GB weights − 5 GB headroom = 3 GB KV → ~30k, rounded to 8k.
    const host = { architecture: "discrete" as const, vramGb: 24 };
    const ctx = recommendServedContextTokens(host, 16);
    expect(ctx).toBeGreaterThanOrEqual(RECOMMENDED_BUILD_CONTEXT_TOKENS);
    expect(ctx).toBeLessThan(MAX_LOCAL_CONTEXT_TOKENS);
  });
  it("falls back to the build floor when the budget is undetectable (e.g. DMR reports no VRAM)", () => {
    expect(recommendServedContextTokens({ architecture: "discrete", vramGb: null }, 16)).toBe(
      RECOMMENDED_BUILD_CONTEXT_TOKENS,
    );
    expect(recommendServedContextTokens({ architecture: "unified", totalRamGb: 128 }, null)).toBe(
      RECOMMENDED_BUILD_CONTEXT_TOKENS,
    );
  });
  it("falls back to the floor when weights leave no room for KV cache", () => {
    expect(recommendServedContextTokens({ architecture: "discrete", vramGb: 18 }, 16)).toBe(
      RECOMMENDED_BUILD_CONTEXT_TOKENS,
    );
  });
});

describe("estimateModelVramGb", () => {
  it("estimates known families", () => {
    expect(estimateModelVramGb("ai/nomic-embed-text-v1.5")).toBe(1);
    expect(estimateModelVramGb("qwen3-coder")).toBe(16); // 30B-A3B
    expect(estimateModelVramGb("ai/qwen3-coder-next")).toBe(48); // 80B MoE
    expect(estimateModelVramGb("ai/qwen3.6:35B-A3B-UD-Q4_K_M")).toBe(22);
    expect(estimateModelVramGb("gemma4:12B")).toBe(8);
    expect(estimateModelVramGb("ai/gemma4")).toBe(20);
    expect(estimateModelVramGb("ai/qwen3:8B-Q4_K_M")).toBe(6);
  });
  it("returns null when unknown", () => {
    expect(estimateModelVramGb("some-mystery-model")).toBeNull();
  });
});

describe("normaliseModelId", () => {
  it("strips docker.io prefix and :latest suffix", () => {
    expect(normaliseModelId("docker.io/ai/qwen3-coder:latest")).toBe("ai/qwen3-coder");
    expect(normaliseModelId("ai/gemma4:12B")).toBe("ai/gemma4:12B");
  });
});

describe("recommendKeepGenerationModel", () => {
  it("prefers a coder model (Build Studio codegen use)", () => {
    const keep = recommendKeepGenerationModel(["ai/gemma4:12B", "qwen3-coder"], 24);
    expect(keep).toBe("qwen3-coder");
  });
  it("falls back to the hardware-recommended tier", () => {
    // 17 GB budget: the headroom-aware recommendation is the 14B (12+5=17), so
    // recommendKeep picks it over the also-present 8B.
    const keep = recommendKeepGenerationModel(["ai/qwen3:8B-Q4_K_M", "ai/qwen3:14B-Q6_K"], 17);
    expect(keep).toBe("ai/qwen3:14B-Q6_K");
  });
  it("returns the single model unchanged", () => {
    expect(recommendKeepGenerationModel(["ai/qwen3:8B-Q4_K_M"], 24)).toBe("ai/qwen3:8B-Q4_K_M");
  });
});

describe("detectLocalModelOverCommit", () => {
  it("one generation model + embedder is healthy", () => {
    const v = detectLocalModelOverCommit({
      installedModelIds: ["qwen3-coder", "ai/nomic-embed-text-v1.5"],
      vramGb: 24,
    });
    expect(v.overCommitted).toBe(false);
    expect(v.generationModelIds).toEqual(["qwen3-coder"]);
    expect(v.embeddingModelIds).toEqual(["ai/nomic-embed-text-v1.5"]);
    expect(v.removeCandidates).toEqual([]);
  });

  it("two generation models over-commit; recommends keeping the coder", () => {
    // The exact scenario from the build host: gemma4 chat + qwen3-coder + embedder.
    const v = detectLocalModelOverCommit({
      installedModelIds: ["ai/gemma4:12B", "qwen3-coder", "ai/nomic-embed-text-v1.5"],
      vramGb: 24,
    });
    expect(v.overCommitted).toBe(true);
    expect(v.recommendedKeep).toBe("qwen3-coder");
    expect(v.removeCandidates).toEqual(["ai/gemma4:12B"]);
    expect(v.reason).toContain("generation models are installed");
  });

  it("flags a single model that exceeds the VRAM budget", () => {
    const v = detectLocalModelOverCommit({
      installedModelIds: ["ai/qwen3.6:35B-A3B-UD-Q4_K_M", "ai/nomic-embed-text-v1.5"],
      vramGb: 12,
    });
    expect(v.overCommitted).toBe(true);
    expect(v.reason).toContain("VRAM");
  });

  it("honors the single-generation-model ceiling constant", () => {
    expect(MAX_CONCURRENT_GENERATION_MODELS).toBe(1);
  });

  it("does not over-flag when VRAM is undetected and only one generation model exists", () => {
    const v = detectLocalModelOverCommit({
      installedModelIds: ["ai/qwen3:8B-Q4_K_M"],
      vramGb: null,
    });
    expect(v.overCommitted).toBe(false);
  });
});
