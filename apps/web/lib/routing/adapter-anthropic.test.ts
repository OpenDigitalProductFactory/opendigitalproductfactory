import { describe, expect, it } from "vitest";
import { anthropicAdapter } from "./adapter-anthropic";
import { EMPTY_PRICING } from "./model-card-types";
import fixture from "./__fixtures__/anthropic-models-response.json";

describe("anthropicAdapter", () => {
  // ── parseDiscoveryResponse ───────────────────────────────────────────

  describe("parseDiscoveryResponse", () => {
    it("returns 2 models from fixture", () => {
      const entries = anthropicAdapter.parseDiscoveryResponse(fixture);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.modelId)).toEqual([
        "claude-opus-4-6",
        "claude-haiku-4-5-20251001",
      ]);
    });
  });

  // ── classifyModel ────────────────────────────────────────────────────

  describe("classifyModel", () => {
    const rawByIndex = (i: number) =>
      (fixture as { data: unknown[] }).data[i];

    it("classifies claude-opus-4-6 as chat", () => {
      expect(
        anthropicAdapter.classifyModel("claude-opus-4-6", rawByIndex(0)),
      ).toBe("chat");
    });

    it("classifies claude-haiku-4-5-20251001 as chat", () => {
      expect(
        anthropicAdapter.classifyModel(
          "claude-haiku-4-5-20251001",
          rawByIndex(1),
        ),
      ).toBe("chat");
    });
  });

  // ── metadataConfidence ───────────────────────────────────────────────

  describe("metadataConfidence", () => {
    it('returns "high"', () => {
      expect(anthropicAdapter.metadataConfidence({})).toBe("high");
    });
  });

  // ── extractModelCard ─────────────────────────────────────────────────

  describe("extractModelCard", () => {
    const opusRaw = (fixture as { data: unknown[] }).data[0];
    const haikuRaw = (fixture as { data: unknown[] }).data[1];

    // ── Full card for claude-opus-4-6 ──────────────────────────────

    describe("claude-opus-4-6 full card", () => {
      const card = anthropicAdapter.extractModelCard(
        "claude-opus-4-6",
        opusRaw,
      );

      it("sets providerId to anthropic", () => {
        expect(card.providerId).toBe("anthropic");
      });

      it("sets modelId", () => {
        expect(card.modelId).toBe("claude-opus-4-6");
      });

      it("sets displayName from display_name field", () => {
        expect(card.displayName).toBe("Claude Opus 4.6");
      });

      it("sets maxInputTokens to 1000000", () => {
        expect(card.maxInputTokens).toBe(1000000);
      });

      it("sets maxOutputTokens to 128000", () => {
        expect(card.maxOutputTokens).toBe(128000);
      });

      it("sets modelClass to chat", () => {
        expect(card.modelClass).toBe("chat");
      });

      it("extracts modelFamily from model ID", () => {
        expect(card.modelFamily).toBe("claude-opus-4");
      });

      it("parses createdAt from ISO string", () => {
        expect(card.createdAt).toEqual(new Date("2026-01-15T00:00:00Z"));
      });

      it("sets metadataSource to api", () => {
        expect(card.metadataSource).toBe("api");
      });

      it('sets metadataConfidence to "high"', () => {
        expect(card.metadataConfidence).toBe("high");
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

      it("sets trainingDataCutoff to null (not in API)", () => {
        expect(card.trainingDataCutoff).toBeNull();
      });

      it("sets reliableKnowledgeCutoff to null (not in API)", () => {
        expect(card.reliableKnowledgeCutoff).toBeNull();
      });

      it("sets status to active", () => {
        expect(card.status).toBe("active");
      });
    });

    // ── Opus capabilities ──────────────────────────────────────────────

    describe("opus capabilities from nested API paths", () => {
      const card = anthropicAdapter.extractModelCard(
        "claude-opus-4-6",
        opusRaw,
      );

      it("sets structuredOutput true", () => {
        expect(card.capabilities.structuredOutput).toBe(true);
      });

      it("sets batch true", () => {
        expect(card.capabilities.batch).toBe(true);
      });

      it("sets citations true", () => {
        expect(card.capabilities.citations).toBe(true);
      });

      it("sets codeExecution true", () => {
        expect(card.capabilities.codeExecution).toBe(true);
      });

      it("sets imageInput true", () => {
        expect(card.capabilities.imageInput).toBe(true);
      });

      it("sets pdfInput true", () => {
        expect(card.capabilities.pdfInput).toBe(true);
      });

      it("sets thinking true", () => {
        expect(card.capabilities.thinking).toBe(true);
      });

      it("sets adaptiveThinking true", () => {
        expect(card.capabilities.adaptiveThinking).toBe(true);
      });

      it("sets contextManagement true", () => {
        expect(card.capabilities.contextManagement).toBe(true);
      });
    });

    // ── Curated capabilities (not from API) ─────────────────────────

    describe("curated capabilities (not from API)", () => {
      const card = anthropicAdapter.extractModelCard(
        "claude-opus-4-6",
        opusRaw,
      );

      it("sets toolUse true (curated)", () => {
        expect(card.capabilities.toolUse).toBe(true);
      });

      it("sets streaming true (curated)", () => {
        expect(card.capabilities.streaming).toBe(true);
      });

      it("sets promptCaching true (curated)", () => {
        expect(card.capabilities.promptCaching).toBe(true);
      });
    });

    // ── Effort levels ────────────────────────────────────────────────

    describe("effortLevels", () => {
      it("opus has all four effort levels", () => {
        const card = anthropicAdapter.extractModelCard(
          "claude-opus-4-6",
          opusRaw,
        );
        expect(card.capabilities.effortLevels).toEqual([
          "low",
          "medium",
          "high",
          "max",
        ]);
      });

      it("haiku has three effort levels (no max)", () => {
        const card = anthropicAdapter.extractModelCard(
          "claude-haiku-4-5-20251001",
          haikuRaw,
        );
        expect(card.capabilities.effortLevels).toEqual([
          "low",
          "medium",
          "high",
        ]);
      });
    });

    // ── Haiku reduced capabilities ───────────────────────────────────

    describe("haiku reduced capabilities", () => {
      const card = anthropicAdapter.extractModelCard(
        "claude-haiku-4-5-20251001",
        haikuRaw,
      );

      it("sets citations false", () => {
        expect(card.capabilities.citations).toBe(false);
      });

      it("sets codeExecution false", () => {
        expect(card.capabilities.codeExecution).toBe(false);
      });

      it("sets contextManagement false", () => {
        expect(card.capabilities.contextManagement).toBe(false);
      });

      it("sets adaptiveThinking false", () => {
        expect(card.capabilities.adaptiveThinking).toBe(false);
      });

      it("sets thinking true (haiku supports thinking)", () => {
        expect(card.capabilities.thinking).toBe(true);
      });

      it("sets batch true (haiku supports batch)", () => {
        expect(card.capabilities.batch).toBe(true);
      });

      it("sets imageInput true (haiku supports image input)", () => {
        expect(card.capabilities.imageInput).toBe(true);
      });

      it("sets pdfInput true (haiku supports pdf input)", () => {
        expect(card.capabilities.pdfInput).toBe(true);
      });

      it("sets structuredOutput true (haiku supports structured output)", () => {
        expect(card.capabilities.structuredOutput).toBe(true);
      });

      it("extracts modelFamily for haiku", () => {
        expect(card.modelFamily).toBe("claude-haiku-4");
      });
    });

    // ── Pricing ──────────────────────────────────────────────────────

    describe("pricing", () => {
      it("is EMPTY_PRICING (not from API)", () => {
        const card = anthropicAdapter.extractModelCard(
          "claude-opus-4-6",
          opusRaw,
        );
        expect(card.pricing).toEqual(EMPTY_PRICING);
      });
    });

    // ── modelClass always chat ───────────────────────────────────────

    describe("modelClass", () => {
      it("is always chat for Anthropic models", () => {
        const opusCard = anthropicAdapter.extractModelCard(
          "claude-opus-4-6",
          opusRaw,
        );
        const haikuCard = anthropicAdapter.extractModelCard(
          "claude-haiku-4-5-20251001",
          haikuRaw,
        );
        expect(opusCard.modelClass).toBe("chat");
        expect(haikuCard.modelClass).toBe("chat");
      });
    });
  });
});
