// apps/web/lib/routing/adapter-ollama.ts
// Provider adapter for local LLM inference (Docker Model Runner / Ollama).
// Uses OpenAI-compatible /v1/models response format.
import type {
  ProviderAdapter,
  DiscoveredModelEntry,
} from "./adapter-interface";
import type { ModelCard, ModelCardPricing } from "./model-card-types";
import {
  EMPTY_CAPABILITIES,
  EMPTY_PRICING,
  DEFAULT_DIMENSION_SCORES,
} from "./model-card-types";
import { classifyModel } from "./model-classifier";
import { computeMetadataHash } from "./metadata-hash";
import {
  deriveLocalModelCapabilityPrior,
  localOutputModalities,
} from "@dpf/db/local-model-capabilities";

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Extract the model family from a model ID.
 * Docker Model Runner: "ai/gemma4" → "gemma4"
 * Ollama legacy:       "gemma4:27b" → "gemma4"
 */
function extractModelFamily(modelId: string): string | null {
  // Strip namespace prefix (e.g., "ai/")
  const bare = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  // Strip tag suffix
  const colon = bare.indexOf(":");
  return colon > 0 ? bare.substring(0, colon) : bare || null;
}

// Tool/function-calling capability for locally-served models is derived from the
// SINGLE shared prior `deriveLocalModelCapabilityPrior` (@dpf/db/local-model-capabilities)
// — the same function the seed uses (packages/db/src/seed.ts). Docker Model Runner
// and Ollama don't advertise per-model capabilities, so it is inferred from the
// model family. Keeping ONE prior for both the seed and this discovery adapter
// closes the seed-vs-runtime fork that wrongly flagged the installed coder model
// (qwen3-coder) non-tool-capable while leaving the embedding model (nomic-embed)
// tool-capable (BI-B6DEBFFE). The old local allowlist (qwen2.5/qwen3 but not
// qwen3-coder; phi4 but not phi3) lived here and disagreed with the prior.

/**
 * Local models are free.
 */
const LOCAL_FREE_PRICING: ModelCardPricing = {
  ...EMPTY_PRICING,
  inputPerMToken: 0,
  outputPerMToken: 0,
};

// ── Adapter implementation ─────────────────────────────────────────────

export const ollamaAdapter: ProviderAdapter = {
  providerId: "ollama",

  parseDiscoveryResponse(json: unknown): DiscoveredModelEntry[] {
    const body = json as Record<string, unknown>;

    // OpenAI-compatible format: { data: [{ id, created, owned_by }] }
    if (body?.data && Array.isArray(body.data)) {
      return (body.data as Array<{ id: string; [k: string]: unknown }>).map((m) => ({
        modelId: m.id,
        rawMetadata: m as unknown as Record<string, unknown>,
      }));
    }

    // Legacy Ollama format: { models: [{ name, ... }] }
    if (body?.models && Array.isArray(body.models)) {
      return (body.models as Array<{ name: string; [k: string]: unknown }>).map((m) => ({
        modelId: m.name,
        rawMetadata: m as unknown as Record<string, unknown>,
      }));
    }

    return [];
  },

  classifyModel(modelId: string, _rawMetadata: unknown) {
    const bareId = extractModelFamily(modelId) ?? modelId;
    return classifyModel(bareId, {
      input: ["text"],
      output: localOutputModalities(modelId),
    });
  },

  extractModelCard(modelId: string, rawMetadata: unknown): ModelCard {
    const raw = rawMetadata as Record<string, unknown>;
    const bareId = extractModelFamily(modelId) ?? modelId;
    const created = typeof raw.created === "number" ? new Date(raw.created * 1000) : null;
    const prior = deriveLocalModelCapabilityPrior(modelId);

    return {
      providerId: "ollama",
      modelId,
      displayName: modelId,
      description: "",
      createdAt: created,

      modelFamily: extractModelFamily(modelId),
      modelClass: classifyModel(bareId, {
        input: ["text"],
        output: localOutputModalities(modelId),
      }),

      maxInputTokens: null,
      maxOutputTokens: null,

      inputModalities: ["text"],
      outputModalities: localOutputModalities(modelId),

      capabilities: {
        ...EMPTY_CAPABILITIES,
        // Definitive booleans from the shared prior (never null): a coder/chat model
        // resolves toolUse=true, an embedding model resolves toolUse=false. Emitting an
        // explicit false (rather than leaving it null) stops the permissive
        // provider-floor fallback in metadata-sync from making an embedding model
        // tool-capable.
        toolUse: prior.supportsToolUse,
        structuredOutput: prior.supportsToolUse,
      },
      pricing: { ...LOCAL_FREE_PRICING },

      supportedParameters: [],
      defaultParameters: null,
      instructType: null,

      trainingDataCutoff: null,
      reliableKnowledgeCutoff: null,

      status: "active",
      deprecationDate: null,
      retiredAt: null,

      perRequestLimits: null,

      metadataSource: "api",
      metadataConfidence: "low",
      lastMetadataRefresh: new Date(),
      rawMetadataHash: computeMetadataHash(rawMetadata),

      dimensionScores: { ...DEFAULT_DIMENSION_SCORES },
      dimensionScoreSource: "inferred",
    };
  },

  metadataConfidence(_rawMetadata: unknown) {
    return "low";
  },
};
