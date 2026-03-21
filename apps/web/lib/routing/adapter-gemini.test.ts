import { describe, expect, it } from "vitest";
import { geminiAdapter } from "./adapter-gemini";
import { EMPTY_PRICING } from "./model-card-types";
import fixture from "./__fixtures__/gemini-models-response.json";

describe("geminiAdapter", () => {
  // ── parseDiscoveryResponse ───────────────────────────────────────────

  describe("parseDiscoveryResponse", () => {
    it("returns 2 models from fixture", () => {
      const entries = geminiAdapter.parseDiscoveryResponse(fixture);
      expect(entries).toHaveLength(2);
    });

    it("strips models/ prefix from model IDs", () => {
      const entries = geminiAdapter.parseDiscoveryResponse(fixture);
      expect(entries.map((e) => e.modelId)).toEqual([
        "gemini-2.0-flash",
        "text-embedding-004",
      ]);
    });

    it("model ID is gemini-2.0-flash not models/gemini-2.0-flash", () => {
      const entries = geminiAdapter.parseDiscoveryResponse(fixture);
      expect(entries[0].modelId).toBe("gemini-2.0-flash");
      expect(entries[0].modelId).not.toContain("models/");
    });
  });

  // ── classifyModel ────────────────────────────────────────────────────

  describe("classifyModel", () => {
    const rawByIndex = (i: number) =>
      (fixture as { models: unknown[] }).models[i];

    it("classifies gemini-2.0-flash as chat", () => {
      expect(
        geminiAdapter.classifyModel("gemini-2.0-flash", rawByIndex(0)),
      ).toBe("chat");
    });

    it("classifies text-embedding-004 as embedding", () => {
      expect(
        geminiAdapter.classifyModel("text-embedding-004", rawByIndex(1)),
      ).toBe("embedding");
    });
  });

  // ── metadataConfidence ───────────────────────────────────────────────

  describe("metadataConfidence", () => {
    it('returns "medium"', () => {
      expect(geminiAdapter.metadataConfidence({})).toBe("medium");
    });
  });

  // ── extractModelCard ─────────────────────────────────────────────────

  describe("extractModelCard", () => {
    const rawModels = (fixture as { models: unknown[] }).models;

    describe("gemini-2.0-flash full card", () => {
      const card = geminiAdapter.extractModelCard(
        "gemini-2.0-flash",
        rawModels[0],
      );

      it("sets providerId to gemini", () => {
        expect(card.providerId).toBe("gemini");
      });

      it("sets modelId", () => {
        expect(card.modelId).toBe("gemini-2.0-flash");
      });

      it("sets displayName from displayName field", () => {
        expect(card.displayName).toBe("Gemini 2.0 Flash");
      });

      it("sets maxInputTokens from inputTokenLimit: 1048576", () => {
        expect(card.maxInputTokens).toBe(1048576);
      });

      it("sets maxOutputTokens from outputTokenLimit: 8192", () => {
        expect(card.maxOutputTokens).toBe(8192);
      });

      it("classifies as chat", () => {
        expect(card.modelClass).toBe("chat");
      });

      it("sets toolUse true for generateContent model", () => {
        expect(card.capabilities.toolUse).toBe(true);
      });

      it("sets codeExecution true for Gemini 2.0+", () => {
        expect(card.capabilities.codeExecution).toBe(true);
      });

      it("sets webSearch true for Gemini 2.0+", () => {
        expect(card.capabilities.webSearch).toBe(true);
      });

      it("sets streaming null (no streamGenerateContent in fixture)", () => {
        // The fixture only has generateContent and countTokens
        expect(card.capabilities.streaming).toBeNull();
      });

      it("sets metadataSource to api", () => {
        expect(card.metadataSource).toBe("api");
      });

      it('sets metadataConfidence to "medium"', () => {
        expect(card.metadataConfidence).toBe("medium");
      });

      it("sets dimensionScoreSource to inferred", () => {
        expect(card.dimensionScoreSource).toBe("inferred");
      });

      it("computes a rawMetadataHash", () => {
        expect(card.rawMetadataHash).toBeTruthy();
        expect(typeof card.rawMetadataHash).toBe("string");
        expect(card.rawMetadataHash.length).toBe(64); // SHA-256 hex
      });

      it("uses DEFAULT_DIMENSION_SCORES", () => {
        expect(card.dimensionScores.reasoning).toBe(50);
        expect(card.dimensionScores.codegen).toBe(50);
        expect(card.dimensionScores.toolFidelity).toBe(50);
        expect(card.dimensionScores.instructionFollowing).toBe(50);
        expect(card.dimensionScores.structuredOutput).toBe(50);
        expect(card.dimensionScores.conversational).toBe(50);
        expect(card.dimensionScores.contextRetention).toBe(50);
        expect(card.dimensionScores.custom).toEqual({});
      });

      it("pricing is EMPTY_PRICING (not from API)", () => {
        expect(card.pricing).toEqual(EMPTY_PRICING);
      });
    });

    // ── text-embedding-004 ────────────────────────────────────────────

    describe("text-embedding-004 card", () => {
      const card = geminiAdapter.extractModelCard(
        "text-embedding-004",
        rawModels[1],
      );

      it("classifies as embedding", () => {
        expect(card.modelClass).toBe("embedding");
      });

      it("sets toolUse null for embedContent-only model", () => {
        expect(card.capabilities.toolUse).toBeNull();
      });

      it("sets codeExecution null for embedding model", () => {
        expect(card.capabilities.codeExecution).toBeNull();
      });

      it("sets webSearch null for embedding model", () => {
        expect(card.capabilities.webSearch).toBeNull();
      });

      it("sets displayName from displayName field", () => {
        expect(card.displayName).toBe("Text Embedding 004");
      });

      it("sets maxInputTokens from inputTokenLimit: 2048", () => {
        expect(card.maxInputTokens).toBe(2048);
      });

      it('sets metadataConfidence to "medium"', () => {
        expect(card.metadataConfidence).toBe("medium");
      });
    });
  });
});
