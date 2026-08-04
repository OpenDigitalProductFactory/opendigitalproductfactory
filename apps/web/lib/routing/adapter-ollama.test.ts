import { describe, expect, it } from "vitest";
import { ollamaAdapter } from "./adapter-ollama";
import { EMPTY_CAPABILITIES } from "./model-card-types";
import fixture from "./__fixtures__/ollama-tags-response.json";

describe("ollamaAdapter", () => {
  // ── parseDiscoveryResponse ───────────────────────────────────────────

  describe("parseDiscoveryResponse", () => {
    it("returns 2 models from fixture", () => {
      const entries = ollamaAdapter.parseDiscoveryResponse(fixture);
      expect(entries).toHaveLength(2);
    });

    it("uses name as modelId", () => {
      const entries = ollamaAdapter.parseDiscoveryResponse(fixture);
      expect(entries.map((e) => e.modelId)).toEqual([
        "llama3.1:latest",
        "phi3:latest",
      ]);
    });
  });

  // ── classifyModel ────────────────────────────────────────────────────

  describe("classifyModel", () => {
    const rawByIndex = (i: number) =>
      (fixture as { models: unknown[] }).models[i];

    it("classifies llama3.1:latest as chat", () => {
      expect(
        ollamaAdapter.classifyModel("llama3.1:latest", rawByIndex(0)),
      ).toBe("chat");
    });

    it("classifies phi3:latest as chat", () => {
      expect(
        ollamaAdapter.classifyModel("phi3:latest", rawByIndex(1)),
      ).toBe("chat");
    });
  });

  // ── metadataConfidence ───────────────────────────────────────────────

  describe("metadataConfidence", () => {
    it('returns "low"', () => {
      expect(ollamaAdapter.metadataConfidence({})).toBe("low");
    });
  });

  // ── extractModelCard ─────────────────────────────────────────────────

  describe("extractModelCard", () => {
    const rawModels = (fixture as { models: unknown[] }).models;

    describe("llama3.1:latest full card", () => {
      const card = ollamaAdapter.extractModelCard(
        "llama3.1:latest",
        rawModels[0],
      );

      it("sets providerId to ollama", () => {
        expect(card.providerId).toBe("ollama");
      });

      it("sets modelId", () => {
        expect(card.modelId).toBe("llama3.1:latest");
      });

      it("classifies as chat", () => {
        expect(card.modelClass).toBe("chat");
      });

      it("sets maxInputTokens to null (not reported by Ollama)", () => {
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

    // ── Pricing — explicitly zero (local = free) ──────────────────────

    describe("pricing (local model = free, not null)", () => {
      const card = ollamaAdapter.extractModelCard(
        "llama3.1:latest",
        rawModels[0],
      );

      it("sets inputPerMToken to 0 (free, local)", () => {
        expect(card.pricing.inputPerMToken).toBe(0);
      });

      it("sets outputPerMToken to 0 (free, local)", () => {
        expect(card.pricing.outputPerMToken).toBe(0);
      });

      it("sets cacheReadPerMToken to null", () => {
        expect(card.pricing.cacheReadPerMToken).toBeNull();
      });

      it("sets cacheWritePerMToken to null", () => {
        expect(card.pricing.cacheWritePerMToken).toBeNull();
      });
    });

    // ── Capabilities — inferred for known tool-capable families ──────

    describe("capabilities", () => {
      const card = ollamaAdapter.extractModelCard(
        "llama3.1:latest",
        rawModels[0],
      );

      it("sets tool and structured output capabilities for tool-capable families", () => {
        expect(card.capabilities).toEqual({
          ...EMPTY_CAPABILITIES,
          toolUse: true,
          structuredOutput: true,
        });
      });

      it("toolUse is true", () => {
        expect(card.capabilities.toolUse).toBe(true);
      });

      it("streaming is null", () => {
        expect(card.capabilities.streaming).toBeNull();
      });
    });

    // ── Capabilities driven by the shared local-model prior (BI-B6DEBFFE) ──
    // The adapter must agree with deriveLocalModelCapabilityPrior (the same prior
    // the seed uses): coder/chat models are tool-capable; embedding models are not.
    // Regression guard for the bug where the installed coder model (qwen3-coder)
    // was flagged non-tool-capable while the embedding model (nomic-embed) was
    // flagged tool-capable.
    describe("capabilities — local prior (coder vs embedding)", () => {
      it("flags qwen3-coder tool-capable (was the missed family)", () => {
        const card = ollamaAdapter.extractModelCard("docker.io/ai/qwen3-coder:latest", {});
        expect(card.capabilities.toolUse).toBe(true);
        expect(card.capabilities.structuredOutput).toBe(true);
      });

      it("flags qwen2.5-coder tool-capable", () => {
        const card = ollamaAdapter.extractModelCard("ai/qwen2.5-coder:7B", {});
        expect(card.capabilities.toolUse).toBe(true);
      });

      it("flags an embedding model NOT tool-capable (definitive false, not null)", () => {
        const card = ollamaAdapter.extractModelCard("docker.io/ai/nomic-embed-text-v1.5:latest", {});
        expect(card.capabilities.toolUse).toBe(false);
        expect(card.capabilities.structuredOutput).toBe(false);
      });
    });

    // ── embedding models are never chat-routable ──────────────────────

    describe("embedding models", () => {
      // Regression: DMR advertises no modality metadata, so the adapter used to
      // hardcode outputModalities=["text"] and register nomic-embed with
      // modelClass="chat". Routing then dispatched chat completions at an
      // embeddings-only llama.cpp context, which 500s with "the current context
      // does not logits computation" — surfaced to the operator as the generic
      // "No AI model can handle this request right now".
      const EMBEDDING_IDS = [
        "docker.io/ai/nomic-embed-text-v1.5:latest",
        "ai/nomic-embed-text:latest",
        "bge-large:latest",
      ];

      for (const modelId of EMBEDDING_IDS) {
        it(`classifies ${modelId} as embedding, not chat`, () => {
          expect(ollamaAdapter.classifyModel(modelId, {})).toBe("embedding");
        });

        it(`emits embeddings output modality for ${modelId}`, () => {
          const card = ollamaAdapter.extractModelCard(modelId, {});
          expect(card.modelClass).toBe("embedding");
          expect(card.outputModalities).toEqual(["embeddings"]);
          expect(card.capabilities.toolUse).toBe(false);
        });
      }

      it("still classifies a chat model as chat", () => {
        const card = ollamaAdapter.extractModelCard(
          "docker.io/ai/qwen3.6:latest",
          {},
        );
        expect(card.modelClass).toBe("chat");
        expect(card.outputModalities).toEqual(["text"]);
      });
    });

    // ── modelFamily extraction ────────────────────────────────────────

    describe("modelFamily extraction", () => {
      it("extracts llama3.1 from llama3.1:latest", () => {
        const card = ollamaAdapter.extractModelCard(
          "llama3.1:latest",
          rawModels[0],
        );
        expect(card.modelFamily).toBe("llama3.1");
      });

      it("extracts phi3 from phi3:latest", () => {
        const card = ollamaAdapter.extractModelCard(
          "phi3:latest",
          rawModels[1],
        );
        expect(card.modelFamily).toBe("phi3");
      });
    });
  });
});
