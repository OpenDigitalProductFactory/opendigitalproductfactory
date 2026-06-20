import { describe, it, expect } from "vitest";
import {
  isEmbeddingModelId,
  classifyLocalModelRole,
  recommendGenerationModel,
  estimateModelVramGb,
  recommendKeepGenerationModel,
  detectLocalModelOverCommit,
  normaliseModelId,
  MAX_CONCURRENT_GENERATION_MODELS,
} from "./local-model-policy";

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

describe("recommendGenerationModel", () => {
  it("null VRAM (undetectable) → broadly-compatible 8B default", () => {
    expect(recommendGenerationModel(null)).toBe("ai/qwen3:8B-Q4_K_M");
  });
  it("0 VRAM (CPU-only host) → 4B tier", () => {
    expect(recommendGenerationModel(0)).toBe("ai/qwen3:4B-UD-Q4_K_XL");
  });
  it("picks the largest tier that fits", () => {
    expect(recommendGenerationModel(24)).toBe("ai/qwen3.6:35B-A3B-UD-Q4_K_M");
    expect(recommendGenerationModel(22)).toBe("ai/qwen3.6:35B-A3B-UD-Q4_K_M");
    expect(recommendGenerationModel(12)).toBe("ai/qwen3:14B-Q6_K");
    expect(recommendGenerationModel(6)).toBe("ai/qwen3:8B-Q4_K_M");
    expect(recommendGenerationModel(5)).toBe("ai/qwen3:4B-UD-Q4_K_XL");
  });
});

describe("estimateModelVramGb", () => {
  it("estimates known families", () => {
    expect(estimateModelVramGb("ai/nomic-embed-text-v1.5")).toBe(1);
    expect(estimateModelVramGb("qwen3-coder")).toBe(16); // 30B-A3B
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
    const keep = recommendKeepGenerationModel(["ai/qwen3:8B-Q4_K_M", "ai/qwen3:14B-Q6_K"], 12);
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
