import { describe, expect, it } from "vitest";
import { openRouterAdapter } from "./adapter-openrouter";
import fixture from "./__fixtures__/openrouter-models-response.json";

describe("openRouterAdapter", () => {
  // ── parseDiscoveryResponse ───────────────────────────────────────────

  describe("parseDiscoveryResponse", () => {
    it("returns 3 models from fixture", () => {
      const entries = openRouterAdapter.parseDiscoveryResponse(fixture);
      expect(entries).toHaveLength(3);
      expect(entries.map((e) => e.modelId)).toEqual([
        "anthropic/claude-sonnet-4-6",
        "openai/o4-mini",
        "openai/text-embedding-3-small",
      ]);
    });
  });

  // ── classifyModel ────────────────────────────────────────────────────

  describe("classifyModel", () => {
    const rawByIndex = (i: number) =>
      (fixture as { data: unknown[] }).data[i];

    it("classifies chat model (claude-sonnet-4-6)", () => {
      expect(
        openRouterAdapter.classifyModel(
          "anthropic/claude-sonnet-4-6",
          rawByIndex(0),
        ),
      ).toBe("chat");
    });

    it("classifies reasoning model (o4-mini) from ID pattern", () => {
      expect(
        openRouterAdapter.classifyModel("openai/o4-mini", rawByIndex(1)),
      ).toBe("reasoning");
    });

    it("classifies embedding model from output_modalities", () => {
      expect(
        openRouterAdapter.classifyModel(
          "openai/text-embedding-3-small",
          rawByIndex(2),
        ),
      ).toBe("embedding");
    });
  });

  // ── metadataConfidence ───────────────────────────────────────────────

  describe("metadataConfidence", () => {
    it('returns "high"', () => {
      expect(openRouterAdapter.metadataConfidence({})).toBe("high");
    });
  });

  // ── extractModelCard ─────────────────────────────────────────────────

  describe("extractModelCard", () => {
    const claudeRaw = (fixture as { data: unknown[] }).data[0];
    const o4Raw = (fixture as { data: unknown[] }).data[1];
    const embedRaw = (fixture as { data: unknown[] }).data[2];

    // Full field extraction for chat model
    describe("chat model (claude-sonnet-4-6)", () => {
      const card = openRouterAdapter.extractModelCard(
        "anthropic/claude-sonnet-4-6",
        claudeRaw,
      );

      it("sets providerId to openrouter", () => {
        expect(card.providerId).toBe("openrouter");
      });

      it("sets modelId", () => {
        expect(card.modelId).toBe("anthropic/claude-sonnet-4-6");
      });

      it("sets displayName", () => {
        expect(card.displayName).toBe("Claude Sonnet 4.6");
      });

      it("sets description", () => {
        expect(card.description).toBe(
          "Fast and intelligent model for coding and analysis",
        );
      });

      it("sets createdAt from unix timestamp", () => {
        expect(card.createdAt).toEqual(new Date(1737849600 * 1000));
      });

      it("sets modelFamily from provider prefix", () => {
        expect(card.modelFamily).toBe("anthropic");
      });

      it("classifies as chat", () => {
        expect(card.modelClass).toBe("chat");
      });

      it("sets maxInputTokens from context_length", () => {
        expect(card.maxInputTokens).toBe(1000000);
      });

      it("sets maxOutputTokens from top_provider.max_completion_tokens", () => {
        expect(card.maxOutputTokens).toBe(64000);
      });

      it("sets inputModalities", () => {
        expect(card.inputModalities).toEqual(["text", "image", "file"]);
      });

      it("sets outputModalities", () => {
        expect(card.outputModalities).toEqual(["text"]);
      });

      it("sets instructType from architecture", () => {
        expect(card.instructType).toBe("claude");
      });

      it("sets supportedParameters", () => {
        expect(card.supportedParameters).toEqual([
          "temperature",
          "top_p",
          "top_k",
          "stream",
          "stop",
          "max_tokens",
          "tools",
          "tool_choice",
          "structured_outputs",
          "frequency_penalty",
          "presence_penalty",
        ]);
      });

      it("sets defaultParameters", () => {
        expect(card.defaultParameters).toEqual({
          temperature: 1.0,
          top_p: null,
          top_k: null,
          frequency_penalty: null,
          presence_penalty: null,
          repetition_penalty: null,
        });
      });

      it("sets perRequestLimits", () => {
        expect(card.perRequestLimits).toEqual({
          promptTokens: 1000000,
          completionTokens: 64000,
        });
      });

      it("sets deprecationDate null when expiration_date is null", () => {
        expect(card.deprecationDate).toBeNull();
      });

      it("sets status to active", () => {
        expect(card.status).toBe("active");
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
    });

    // ── Capabilities ─────────────────────────────────────────────────

    describe("capabilities from supported_parameters", () => {
      const card = openRouterAdapter.extractModelCard(
        "anthropic/claude-sonnet-4-6",
        claudeRaw,
      );

      it("sets toolUse true when tools in supported_parameters", () => {
        expect(card.capabilities.toolUse).toBe(true);
      });

      it("sets structuredOutput true when structured_outputs in supported_parameters", () => {
        expect(card.capabilities.structuredOutput).toBe(true);
      });

      it("sets streaming true when stream in supported_parameters", () => {
        expect(card.capabilities.streaming).toBe(true);
      });

      it("sets imageInput true when image in input_modalities", () => {
        expect(card.capabilities.imageInput).toBe(true);
      });

      it("sets pdfInput true when file in input_modalities", () => {
        expect(card.capabilities.pdfInput).toBe(true);
      });
    });

    describe("empty supported_parameters yields all capabilities null", () => {
      const card = openRouterAdapter.extractModelCard(
        "openai/text-embedding-3-small",
        embedRaw,
      );

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

    // ── Pricing conversion ───────────────────────────────────────────

    describe("pricing conversion (per-token string → per-million-tokens number)", () => {
      const card = openRouterAdapter.extractModelCard(
        "anthropic/claude-sonnet-4-6",
        claudeRaw,
      );

      it("converts prompt pricing: 0.000003 → 3.0 per M tokens", () => {
        expect(card.pricing.inputPerMToken).toBe(3.0);
      });

      it("converts completion pricing: 0.000015 → 15.0 per M tokens", () => {
        expect(card.pricing.outputPerMToken).toBe(15.0);
      });

      it("converts cache read pricing: 0.0000003 → 0.3 per M tokens", () => {
        expect(card.pricing.cacheReadPerMToken).toBe(0.3);
      });

      it("converts cache write pricing: 0.00000375 → 3.75 per M tokens", () => {
        expect(card.pricing.cacheWritePerMToken).toBe(3.75);
      });

      it("converts image_token pricing: 0.0000048 → 4.8 per M tokens", () => {
        expect(card.pricing.imageInputPerMToken).toBe(4.8);
      });

      it("converts image_output pricing: 0 → null (zero = not applicable)", () => {
        expect(card.pricing.imageOutputPerUnit).toBeNull();
      });

      it("converts audio pricing: 0 → null", () => {
        expect(card.pricing.audioInputPerMToken).toBeNull();
      });

      it("converts audio_output pricing: 0 → null", () => {
        expect(card.pricing.audioOutputPerMToken).toBeNull();
      });

      it("converts request pricing: 0 → null", () => {
        expect(card.pricing.requestFixed).toBeNull();
      });

      it("converts web_search pricing: 0 → null", () => {
        expect(card.pricing.webSearchPerRequest).toBeNull();
      });

      it("converts internal_reasoning pricing: 0 → null for non-reasoning model", () => {
        expect(card.pricing.reasoningPerMToken).toBeNull();
      });

      it("sets discount from numeric field", () => {
        expect(card.pricing.discount).toBe(0);
      });
    });

    describe("reasoning model pricing (o4-mini)", () => {
      const card = openRouterAdapter.extractModelCard(
        "openai/o4-mini",
        o4Raw,
      );

      it("extracts internal_reasoning pricing: 0.0000044 → 4.4 per M tokens", () => {
        expect(card.pricing.reasoningPerMToken).toBe(4.4);
      });

      it("extracts input pricing: 0.0000011 → 1.1 per M tokens", () => {
        expect(card.pricing.inputPerMToken).toBe(1.1);
      });

      it("extracts output pricing: 0.0000044 → 4.4 per M tokens", () => {
        expect(card.pricing.outputPerMToken).toBe(4.4);
      });

      it("extracts cache_read pricing: 0.00000055 → 0.55 per M tokens", () => {
        expect(card.pricing.cacheReadPerMToken).toBe(0.55);
      });

      it("sets cacheWrite null when value is 0", () => {
        expect(card.pricing.cacheWritePerMToken).toBeNull();
      });
    });

    // ── Embedding model ──────────────────────────────────────────────

    describe("embedding model (text-embedding-3-small)", () => {
      const card = openRouterAdapter.extractModelCard(
        "openai/text-embedding-3-small",
        embedRaw,
      );

      it("classifies as embedding", () => {
        expect(card.modelClass).toBe("embedding");
      });

      it("has input pricing", () => {
        expect(card.pricing.inputPerMToken).toBe(0.02);
      });

      it("has null output pricing (zero)", () => {
        expect(card.pricing.outputPerMToken).toBeNull();
      });

      it("has maxOutputTokens null when top_provider.max_completion_tokens is null", () => {
        expect(card.maxOutputTokens).toBeNull();
      });

      it("sets instructType to null when architecture.instruct_type is null", () => {
        expect(card.instructType).toBeNull();
      });
    });

    // ── Missing/null fields ──────────────────────────────────────────

    describe("missing/null fields produce null (not zero, not crash)", () => {
      it("handles model with minimal metadata without crashing", () => {
        const minimal = {
          id: "test/minimal-model",
          name: "Minimal",
          created: null,
          description: "",
          pricing: {},
          context_length: null,
          architecture: {
            tokenizer: null,
            instruct_type: null,
            modality: "text->text",
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
          top_provider: {
            context_length: null,
            max_completion_tokens: null,
            is_moderated: false,
          },
          per_request_limits: null,
          supported_parameters: [],
          default_parameters: null,
          expiration_date: null,
        };

        const card = openRouterAdapter.extractModelCard(
          "test/minimal-model",
          minimal,
        );

        expect(card.maxInputTokens).toBeNull();
        expect(card.maxOutputTokens).toBeNull();
        expect(card.createdAt).toBeNull();
        expect(card.pricing.inputPerMToken).toBeNull();
        expect(card.pricing.outputPerMToken).toBeNull();
        expect(card.perRequestLimits).toBeNull();
        expect(card.defaultParameters).toBeNull();
        expect(card.deprecationDate).toBeNull();
      });
    });

    // ── Dimension scores ─────────────────────────────────────────────

    describe("dimension scores", () => {
      const card = openRouterAdapter.extractModelCard(
        "anthropic/claude-sonnet-4-6",
        claudeRaw,
      );

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
  });
});
