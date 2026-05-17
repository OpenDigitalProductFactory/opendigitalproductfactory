import { describe, it, expect } from "vitest";
import { assignTierFromModelId } from "./quality-tiers";

describe("assignTierFromModelId", () => {
  describe("cloud models (unchanged behaviour)", () => {
    it("assigns frontier to claude-opus-4", () => {
      expect(assignTierFromModelId("claude-opus-4-7-20250514")).toBe("frontier");
    });
    it("assigns frontier to claude-sonnet-4", () => {
      expect(assignTierFromModelId("claude-sonnet-4-5")).toBe("frontier");
    });
    it("assigns strong to claude-haiku-4", () => {
      expect(assignTierFromModelId("claude-haiku-4-5-20251001")).toBe("strong");
    });
    it("assigns strong to gpt-4o", () => {
      expect(assignTierFromModelId("gpt-4o-2024-11-20")).toBe("strong");
    });
    it("assigns adequate to gpt-4o-mini", () => {
      expect(assignTierFromModelId("gpt-4o-mini")).toBe("adequate");
    });
  });

  describe("Docker Model Runner IDs (namespace prefix stripping)", () => {
    it("assigns strong to ai/qwen3:8b", () => {
      expect(assignTierFromModelId("ai/qwen3:8b")).toBe("strong");
    });
    it("assigns strong to ai/qwen3:14b", () => {
      expect(assignTierFromModelId("ai/qwen3:14b")).toBe("strong");
    });
    it("assigns strong to ai/qwen3:32b", () => {
      expect(assignTierFromModelId("ai/qwen3:32b")).toBe("strong");
    });
    it("assigns strong to docker.io/ai/qwen3:8b", () => {
      expect(assignTierFromModelId("docker.io/ai/qwen3:8b")).toBe("strong");
    });
    it("assigns strong to ai/qwen2.5-coder:14b", () => {
      expect(assignTierFromModelId("ai/qwen2.5-coder:14b")).toBe("strong");
    });
    it("assigns adequate to ai/gemma4:latest", () => {
      expect(assignTierFromModelId("ai/gemma4:latest")).toBe("adequate");
    });
    it("assigns adequate to docker.io/ai/gemma4:latest", () => {
      expect(assignTierFromModelId("docker.io/ai/gemma4:latest")).toBe("adequate");
    });
    it("assigns basic to ai/qwen2:7b (unversioned qwen fallback)", () => {
      expect(assignTierFromModelId("ai/qwen2:7b")).toBe("basic");
    });
    it("assigns basic to ai/llama3.1:8b", () => {
      expect(assignTierFromModelId("ai/llama3.1:8b")).toBe("basic");
    });
    it("assigns basic to ai/mistral:7b", () => {
      expect(assignTierFromModelId("ai/mistral:7b")).toBe("basic");
    });
  });

  describe("Ollama-style IDs (tag stripping only)", () => {
    it("assigns strong to qwen3:8b", () => {
      expect(assignTierFromModelId("qwen3:8b")).toBe("strong");
    });
    it("assigns adequate to gemma4:27b", () => {
      expect(assignTierFromModelId("gemma4:27b")).toBe("adequate");
    });
    it("assigns basic to llama3.1:70b", () => {
      expect(assignTierFromModelId("llama3.1:70b")).toBe("basic");
    });
  });

  describe("unknown models", () => {
    it("returns adequate as conservative default", () => {
      expect(assignTierFromModelId("some-unknown-model")).toBe("adequate");
    });
  });
});
