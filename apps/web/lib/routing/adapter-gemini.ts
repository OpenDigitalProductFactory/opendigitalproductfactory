// apps/web/lib/routing/adapter-gemini.ts
import type {
  ProviderAdapter,
  DiscoveredModelEntry,
} from "./adapter-interface";
import type { ModelCard, ModelCardCapabilities } from "./model-card-types";
import {
  EMPTY_CAPABILITIES,
  EMPTY_PRICING,
  DEFAULT_DIMENSION_SCORES,
} from "./model-card-types";
import { classifyModel } from "./model-classifier";
import { computeMetadataHash } from "./metadata-hash";

// ── Internal types for raw Gemini API data ─────────────────────────

interface GeminiModel {
  name: string;
  version?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  temperature?: number;
  maxTemperature?: number;
  topP?: number;
  topK?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Strip the "models/" prefix from a Gemini model name.
 * e.g. "models/gemini-2.0-flash" → "gemini-2.0-flash"
 */
function stripModelsPrefix(name: string): string {
  return name.startsWith("models/") ? name.slice("models/".length) : name;
}

/**
 * Determine if this is an embedding-only model based on supported generation methods.
 * Embedding models only support "embedContent", not "generateContent".
 */
function isEmbeddingOnly(methods: string[]): boolean {
  return methods.includes("embedContent") && !methods.includes("generateContent");
}

/**
 * Extract capabilities from Gemini model metadata.
 * toolUse is approximated from supportedGenerationMethods including "generateContent".
 */
function extractCapabilities(raw: GeminiModel): ModelCardCapabilities {
  const methods = raw.supportedGenerationMethods ?? [];

  const toolUse = methods.includes("generateContent") ? true : null;

  return {
    ...EMPTY_CAPABILITIES,
    toolUse,
  };
}

// ── Adapter implementation ─────────────────────────────────────────────

export const geminiAdapter: ProviderAdapter = {
  providerId: "gemini",

  parseDiscoveryResponse(json: unknown): DiscoveredModelEntry[] {
    const body = json as { models?: GeminiModel[] };
    const models = body?.models ?? [];
    return models.map((m) => ({
      modelId: stripModelsPrefix(m.name),
      rawMetadata: m as unknown as Record<string, unknown>,
    }));
  },

  classifyModel(modelId: string, rawMetadata: unknown) {
    const raw = rawMetadata as GeminiModel;
    const methods = raw.supportedGenerationMethods ?? [];

    if (isEmbeddingOnly(methods)) {
      return "embedding";
    }

    return classifyModel(modelId, {
      input: ["text"],
      output: ["text"],
    });
  },

  extractModelCard(modelId: string, rawMetadata: unknown): ModelCard {
    const raw = rawMetadata as GeminiModel;
    const methods = raw.supportedGenerationMethods ?? [];

    const modelClass = isEmbeddingOnly(methods)
      ? "embedding"
      : classifyModel(modelId, { input: ["text"], output: ["text"] });

    return {
      providerId: "gemini",
      modelId,
      displayName: raw.displayName ?? modelId,
      description: raw.description ?? "",
      createdAt: null,

      modelFamily: null,
      modelClass,

      maxInputTokens: raw.inputTokenLimit ?? null,
      maxOutputTokens: raw.outputTokenLimit ?? null,

      inputModalities: ["text"],
      outputModalities: ["text"],

      capabilities: extractCapabilities(raw),
      pricing: { ...EMPTY_PRICING },

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
      metadataConfidence: "medium",
      lastMetadataRefresh: new Date(),
      rawMetadataHash: computeMetadataHash(rawMetadata),

      dimensionScores: { ...DEFAULT_DIMENSION_SCORES },
      dimensionScoreSource: "inferred",
    };
  },

  metadataConfidence(_rawMetadata: unknown) {
    return "medium";
  },
};
