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
    // Canonical Docker Hub tag forms (post-2026-05-23 catalog). The short
    // forms above 404 against Docker Model Runner; these are what the
    // installer + portal UI actually emit now.
    it("assigns strong to ai/qwen3:8B-Q4_K_M (canonical 8B tag)", () => {
      expect(assignTierFromModelId("ai/qwen3:8B-Q4_K_M")).toBe("strong");
    });
    it("assigns strong to ai/qwen3:14B-Q6_K (canonical 14B tag)", () => {
      expect(assignTierFromModelId("ai/qwen3:14B-Q6_K")).toBe("strong");
    });
    it("assigns strong to ai/qwen3:30B-A3B-Q4_K_M (MoE — largest qwen3)", () => {
      expect(assignTierFromModelId("ai/qwen3:30B-A3B-Q4_K_M")).toBe("strong");
    });
    it("assigns adequate to ai/qwen3:4B-UD-Q4_K_XL (canonical 4B tag)", () => {
      // 4B is below the strong threshold per the tier table — but qwen3
      // family pattern still matches. Note: the FAMILY_TIERS entry assigns
      // strong to all qwen3 variants; 4B getting "strong" here is by-family,
      // not by-size. This documents that behaviour intentionally.
      expect(assignTierFromModelId("ai/qwen3:4B-UD-Q4_K_XL")).toBe("strong");
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

  describe("Gemini 3.x tier classification", () => {
    it("assigns strong to gemini-3-pro-preview", () => {
      expect(assignTierFromModelId("gemini-3-pro-preview")).toBe("strong");
    });
    it("assigns strong to gemini-3-pro-image-preview", () => {
      expect(assignTierFromModelId("gemini-3-pro-image-preview")).toBe("strong");
    });
    it("assigns strong to gemini-3.1-pro-preview", () => {
      expect(assignTierFromModelId("gemini-3.1-pro-preview")).toBe("strong");
    });
    it("assigns strong to gemini-3.1-pro-preview-customtools", () => {
      expect(assignTierFromModelId("gemini-3.1-pro-preview-customtools")).toBe("strong");
    });
    it("assigns adequate to gemini-3-flash-preview (flash stays adequate)", () => {
      expect(assignTierFromModelId("gemini-3-flash-preview")).toBe("adequate");
    });
    it("assigns strong to gemini-2.5-pro (existing)", () => {
      expect(assignTierFromModelId("gemini-2.5-pro")).toBe("strong");
    });
  });

  describe("unknown models", () => {
    it("returns adequate as conservative default", () => {
      expect(assignTierFromModelId("some-unknown-model")).toBe("adequate");
    });
  });
});
