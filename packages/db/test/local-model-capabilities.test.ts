import { describe, expect, it } from "vitest";
import {
  deriveLocalModelCapabilityPrior,
  detectLocalModelAudio,
  detectLocalModelFamily,
  detectLocalModelVision,
  localInputModalities,
  normalizeLocalModelId,
} from "../src/local-model-capabilities";

describe("normalizeLocalModelId", () => {
  it("strips docker.io/ and ai/ registry prefixes and lowercases", () => {
    expect(normalizeLocalModelId("docker.io/ai/gemma4:latest")).toBe("gemma4:latest");
    expect(normalizeLocalModelId("ai/qwen3:14B-Q6_K")).toBe("qwen3:14b-q6_k");
    expect(normalizeLocalModelId("Gemma4:26B")).toBe("gemma4:26b");
  });
});

describe("detectLocalModelFamily", () => {
  it("classifies the models currently bundled via Docker Model Runner", () => {
    expect(detectLocalModelFamily("docker.io/ai/gemma4:latest")).toBe("gemma");
    expect(detectLocalModelFamily("docker.io/ai/gemma4:26B")).toBe("gemma");
    expect(detectLocalModelFamily("docker.io/ai/magistral-small-3.2:latest")).toBe("magistral");
    expect(detectLocalModelFamily("docker.io/ai/qwen3:14B-Q6_K")).toBe("qwen");
    expect(detectLocalModelFamily("docker.io/ai/nomic-embed-text-v1.5:latest")).toBe("embedding");
  });

  it("detects qwen coder before the generic qwen tier", () => {
    expect(detectLocalModelFamily("ai/qwen2.5-coder:7B")).toBe("qwen-coder");
  });

  it("detects qwen+coder in either order, and requires both", () => {
    expect(detectLocalModelFamily("ai/coder-qwen:latest")).toBe("qwen-coder");
    // "coder" alone (no qwen) must not be classified qwen-coder.
    expect(detectLocalModelFamily("ai/deepseek-coder:6.7b")).toBe("deepseek");
  });

  it("classifies a pathological repeated-token id in linear time (no ReDoS)", () => {
    // Guards the js/polynomial-redos fix: an adversarial id of many 'qwen'/'coder'
    // repetitions must not trigger catastrophic backtracking.
    const evil = `${"qwen".repeat(50000)}x`;
    const start = performance.now();
    expect(detectLocalModelFamily(evil)).toBe("qwen");
    expect(detectLocalModelAudio(evil)).toBe(false);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe("deriveLocalModelCapabilityPrior", () => {
  it("never returns the old flat toolFidelity=20 for a chat model", () => {
    // Regression guard: the flat-20 prior is what made routing unable to tell a
    // strong tool-caller from a reasoning model from an embedding model.
    for (const id of [
      "ai/gemma4:latest",
      "ai/qwen3:14B-Q6_K",
      "ai/magistral-small-3.2:latest",
      "ai/some-unknown-model:latest",
    ]) {
      expect(deriveLocalModelCapabilityPrior(id).toolFidelity).not.toBe(20);
    }
  });

  it("scores Qwen3 as a strong tool-caller", () => {
    const p = deriveLocalModelCapabilityPrior("ai/qwen3:14B-Q6_K");
    expect(p.supportsToolUse).toBe(true);
    expect(p.toolFidelity).toBeGreaterThanOrEqual(75);
    expect(p.isEmbedding).toBe(false);
  });

  it("scores Gemma as tool-capable (verified emits clean tool_calls)", () => {
    const p = deriveLocalModelCapabilityPrior("docker.io/ai/gemma4:latest");
    expect(p.supportsToolUse).toBe(true);
    expect(p.toolFidelity).toBeGreaterThanOrEqual(60);
  });

  it("scores Magistral (reasoning model) as a weak tool-caller and warns against agentic use", () => {
    const p = deriveLocalModelCapabilityPrior("ai/magistral-small-3.2:latest");
    expect(p.toolFidelity).toBeLessThanOrEqual(35);
    expect(p.avoidFor).toContain("tool-use");
  });

  it("classifies embedding models as non-chat, non-tool", () => {
    const p = deriveLocalModelCapabilityPrior("docker.io/ai/nomic-embed-text-v1.5:latest");
    expect(p.isEmbedding).toBe(true);
    expect(p.supportsToolUse).toBe(false);
    expect(p.toolFidelity).toBe(0);
    expect(p.capabilityCategory).toBe("embedding");
  });

  it("gives an unknown chat model a conservative but routable prior", () => {
    const p = deriveLocalModelCapabilityPrior("ai/brand-new-model:latest");
    expect(p.isEmbedding).toBe(false);
    expect(p.supportsToolUse).toBe(true);
    expect(p.toolFidelity).toBeGreaterThan(20);
    expect(p.toolFidelity).toBeLessThan(60);
  });

  it("flags multimodal models as vision-capable (drives imageInput floor)", () => {
    // Verified on-machine 2026-06-15: ai/gemma4:12B does real vision via DMR.
    expect(deriveLocalModelCapabilityPrior("ai/gemma4:12B").supportsVision).toBe(true);
    expect(deriveLocalModelCapabilityPrior("docker.io/ai/gemma4:26B").supportsVision).toBe(true);
  });

  it("does not flag text-only local models as vision-capable", () => {
    expect(deriveLocalModelCapabilityPrior("ai/qwen3:14B-Q6_K").supportsVision).toBe(false);
    expect(deriveLocalModelCapabilityPrior("ai/qwen2.5-coder:7B").supportsVision).toBe(false);
    expect(deriveLocalModelCapabilityPrior("ai/magistral-small-3.2:latest").supportsVision).toBe(false);
  });

  it("never marks an embedding model vision-capable", () => {
    expect(deriveLocalModelCapabilityPrior("docker.io/ai/nomic-embed-text-v1.5:latest").supportsVision).toBe(false);
  });

  it("flags audio-capable models (drives audioInput floor) — verified on-machine for Gemma 4", () => {
    expect(deriveLocalModelCapabilityPrior("ai/gemma4:12B").supportsAudio).toBe(true);
    expect(deriveLocalModelCapabilityPrior("ai/qwen3-omni:latest").supportsAudio).toBe(true);
  });

  it("does not flag text-only / embedding models as audio-capable", () => {
    expect(deriveLocalModelCapabilityPrior("ai/qwen3-coder:latest").supportsAudio).toBe(false);
    expect(deriveLocalModelCapabilityPrior("ai/gemma3:latest").supportsAudio).toBe(false);
    expect(deriveLocalModelCapabilityPrior("docker.io/ai/nomic-embed-text-v1.5:latest").supportsAudio).toBe(false);
  });

  it("derives input modalities from the prior (text + image + audio for Gemma 4)", () => {
    expect(localInputModalities(deriveLocalModelCapabilityPrior("ai/gemma4:12B"))).toEqual([
      "text", "image", "audio",
    ]);
    expect(localInputModalities(deriveLocalModelCapabilityPrior("ai/qwen3-coder:latest"))).toEqual(["text"]);
    expect(localInputModalities(deriveLocalModelCapabilityPrior("ai/nomic-embed-text-v1.5:latest"))).toEqual(["text"]);
  });
});

describe("detectLocalModelAudio", () => {
  it("detects audio-input families", () => {
    for (const id of ["ai/gemma4:12B", "docker.io/ai/gemma3n:latest", "ai/whisper-large:latest", "ai/qwen2.5-omni:7b", "ai/ultravox:latest"]) {
      expect(detectLocalModelAudio(id)).toBe(true);
    }
  });
  it("returns false for text-only and embedding models", () => {
    for (const id of ["ai/qwen3-coder:latest", "ai/gemma3:latest", "ai/llama3.3:latest", "docker.io/ai/nomic-embed-text-v1.5:latest"]) {
      expect(detectLocalModelAudio(id)).toBe(false);
    }
  });
});

describe("detectLocalModelVision", () => {
  it("detects multimodal families orthogonal to the text/tool family", () => {
    for (const id of [
      "ai/gemma4:12B",
      "docker.io/ai/gemma3n:latest",
      "ai/llava:13b",
      "ai/moondream2:latest",
      "ai/pixtral-12b:latest",
      "ai/qwen2.5-vl:7b",
      "ai/minicpm-v:latest",
    ]) {
      expect(detectLocalModelVision(id)).toBe(true);
    }
  });

  it("returns false for text-only and embedding models", () => {
    for (const id of [
      "ai/qwen3-coder:latest",
      "ai/gemma3:latest",
      "ai/magistral-small-3.2:latest",
      "docker.io/ai/nomic-embed-text-v1.5:latest",
    ]) {
      expect(detectLocalModelVision(id)).toBe(false);
    }
  });
});
