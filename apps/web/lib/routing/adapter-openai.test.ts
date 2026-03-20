import { describe, expect, it } from "vitest";
import { openAIAdapter } from "./adapter-openai";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import fixture from "./__fixtures__/openai-models-response.json";

describe("openAIAdapter", () => {
  // ── parseDiscoveryResponse ───────────────────────────────────────────

  describe("parseDiscoveryResponse", () => {
    it("returns 7 models from fixture", () => {
      const entries = openAIAdapter.parseDiscoveryResponse(fixture);
      expect(entries).toHaveLength(7);
      expect(entries.map((e) => e.modelId)).toEqual([
        "gpt-4o",
        "o4-mini",
        "text-embedding-3-small",
        "dall-e-3",
        "tts-1",
        "whisper-1",
        "omni-moderation-latest",
      ]);
    });
  });

  // ── classifyModel ────────────────────────────────────────────────────

  describe("classifyModel", () => {
    const rawByIndex = (i: number) =>
      (fixture as { data: unknown[] }).data[i];

    it("classifies gpt-4o as chat", () => {
      expect(openAIAdapter.classifyModel("gpt-4o", rawByIndex(0))).toBe("chat");
    });

    it("classifies o4-mini as reasoning", () => {
      expect(openAIAdapter.classifyModel("o4-mini", rawByIndex(1))).toBe("reasoning");
    });

    it("classifies text-embedding-3-small as embedding", () => {
      expect(
        openAIAdapter.classifyModel("text-embedding-3-small", rawByIndex(2)),
      ).toBe("embedding");
    });

    it("classifies dall-e-3 as image_gen", () => {
      expect(openAIAdapter.classifyModel("dall-e-3", rawByIndex(3))).toBe(
        "image_gen",
      );
    });

    it("classifies tts-1 as speech", () => {
      expect(openAIAdapter.classifyModel("tts-1", rawByIndex(4))).toBe("speech");
    });

    it("classifies whisper-1 as audio", () => {
      expect(openAIAdapter.classifyModel("whisper-1", rawByIndex(5))).toBe(
        "audio",
      );
    });

    it("classifies omni-moderation-latest as moderation", () => {
      expect(
        openAIAdapter.classifyModel("omni-moderation-latest", rawByIndex(6)),
      ).toBe("moderation");
    });
  });

  // ── metadataConfidence ───────────────────────────────────────────────

  describe("metadataConfidence", () => {
    it('returns "low"', () => {
      expect(openAIAdapter.metadataConfidence({})).toBe("low");
    });
  });

  // ── extractModelCard ─────────────────────────────────────────────────

  describe("extractModelCard", () => {
    const rawModels = (fixture as { data: unknown[] }).data;

    describe("gpt-4o full card", () => {
      const card = openAIAdapter.extractModelCard("gpt-4o", rawModels[0]);

      it("sets providerId to openai", () => {
        expect(card.providerId).toBe("openai");
      });

      it("sets modelId", () => {
        expect(card.modelId).toBe("gpt-4o");
      });

      it("sets displayName with capitalization", () => {
        expect(card.displayName).toBe("GPT-4o");
      });

      it("sets description to empty string", () => {
        expect(card.description).toBe("");
      });

      it("sets createdAt from unix timestamp", () => {
        expect(card.createdAt).toEqual(new Date(1715367049 * 1000));
      });

      it("sets modelClass to chat", () => {
        expect(card.modelClass).toBe("chat");
      });

      it("sets maxInputTokens to null", () => {
        expect(card.maxInputTokens).toBeNull();
      });

      it("sets maxOutputTokens to null", () => {
        expect(card.maxOutputTokens).toBeNull();
      });

      it("sets inputModalities to text", () => {
        expect(card.inputModalities).toEqual(["text"]);
      });

      it("sets outputModalities to text", () => {
        expect(card.outputModalities).toEqual(["text"]);
      });

      it("sets supportedParameters to empty array", () => {
        expect(card.supportedParameters).toEqual([]);
      });

      it("sets metadataSource to api", () => {
        expect(card.metadataSource).toBe("api");
      });

      it('sets metadataConfidence to "low"', () => {
        expect(card.metadataConfidence).toBe("low");
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
    });

    // ── Capabilities ─────────────────────────────────────────────────

    describe("capabilities", () => {
      const card = openAIAdapter.extractModelCard("gpt-4o", rawModels[0]);

      it("all capabilities are null (EMPTY_CAPABILITIES)", () => {
        expect(card.capabilities).toEqual(EMPTY_CAPABILITIES);
      });

      it("toolUse is null", () => {
        expect(card.capabilities.toolUse).toBeNull();
      });

      it("structuredOutput is null", () => {
        expect(card.capabilities.structuredOutput).toBeNull();
      });

      it("streaming is null", () => {
        expect(card.capabilities.streaming).toBeNull();
      });
    });

    // ── Pricing ──────────────────────────────────────────────────────

    describe("pricing", () => {
      const card = openAIAdapter.extractModelCard("gpt-4o", rawModels[0]);

      it("all pricing is null (EMPTY_PRICING)", () => {
        expect(card.pricing).toEqual(EMPTY_PRICING);
      });

      it("inputPerMToken is null", () => {
        expect(card.pricing.inputPerMToken).toBeNull();
      });

      it("outputPerMToken is null", () => {
        expect(card.pricing.outputPerMToken).toBeNull();
      });
    });

    // ── Per-model classification ──────────────────────────────────────

    describe("o4-mini card", () => {
      const card = openAIAdapter.extractModelCard("o4-mini", rawModels[1]);

      it("classifies as reasoning", () => {
        expect(card.modelClass).toBe("reasoning");
      });
    });

    describe("text-embedding-3-small card", () => {
      const card = openAIAdapter.extractModelCard(
        "text-embedding-3-small",
        rawModels[2],
      );

      it("classifies as embedding", () => {
        expect(card.modelClass).toBe("embedding");
      });
    });

    describe("dall-e-3 card", () => {
      const card = openAIAdapter.extractModelCard("dall-e-3", rawModels[3]);

      it("classifies as image_gen", () => {
        expect(card.modelClass).toBe("image_gen");
      });
    });

    describe("tts-1 card", () => {
      const card = openAIAdapter.extractModelCard("tts-1", rawModels[4]);

      it("classifies as speech", () => {
        expect(card.modelClass).toBe("speech");
      });
    });

    describe("whisper-1 card", () => {
      const card = openAIAdapter.extractModelCard("whisper-1", rawModels[5]);

      it("classifies as audio", () => {
        expect(card.modelClass).toBe("audio");
      });
    });

    describe("omni-moderation-latest card", () => {
      const card = openAIAdapter.extractModelCard(
        "omni-moderation-latest",
        rawModels[6],
      );

      it("classifies as moderation", () => {
        expect(card.modelClass).toBe("moderation");
      });
    });
  });
});
