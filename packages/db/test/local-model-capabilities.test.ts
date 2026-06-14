import { describe, expect, it } from "vitest";
import {
  deriveLocalModelCapabilityPrior,
  detectLocalModelFamily,
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
});
