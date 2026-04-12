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

/**
 * Known model families that support tool/function calling via the
 * OpenAI-compatible API. These models return proper `tool_calls` in
 * their responses when tools are provided in the request.
 *
 * This is necessary because Docker Model Runner and Ollama don't
 * advertise per-model capabilities — we must infer from the model name.
 */
const TOOL_CAPABLE_FAMILIES = new Set([
  "llama3.1", "llama3.2", "llama3.3", "llama4",
  "qwen2.5", "qwen3",
  "mistral", "mixtral", "mistral-small", "mistral-nemo",
  "gemma2", "gemma3", "gemma4",
  "phi4",
  "command-r",
  "deepseek-v2", "deepseek-v3",
]);

function isToolCapableFamily(modelId: string): boolean {
  const family = extractModelFamily(modelId);
  if (!family) return false;
  return TOOL_CAPABLE_FAMILIES.has(family.toLowerCase());
}

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
      output: ["text"],
    });
  },

  extractModelCard(modelId: string, rawMetadata: unknown): ModelCard {
    const raw = rawMetadata as Record<string, unknown>;
    const bareId = extractModelFamily(modelId) ?? modelId;
    const created = typeof raw.created === "number" ? new Date(raw.created * 1000) : null;

    return {
      providerId: "ollama",
      modelId,
      displayName: modelId,
      description: "",
      createdAt: created,

      modelFamily: extractModelFamily(modelId),
      modelClass: classifyModel(bareId, {
        input: ["text"],
        output: ["text"],
      }),

      maxInputTokens: null,
      maxOutputTokens: null,

      inputModalities: ["text"],
      outputModalities: ["text"],

      capabilities: {
        ...EMPTY_CAPABILITIES,
        ...(isToolCapableFamily(modelId) ? { toolUse: true, structuredOutput: true } : {}),
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
