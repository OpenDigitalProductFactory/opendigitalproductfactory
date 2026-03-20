// apps/web/lib/routing/adapter-ollama.ts
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

// ── Internal types for raw Ollama API data ─────────────────────────

interface OllamaModelDetails {
  parent_model?: string;
  format?: string;
  family?: string;
  families?: string[];
  parameter_size?: string;
  quantization_level?: string;
}

interface OllamaModel {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: OllamaModelDetails;
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Extract the model family from an Ollama model name by stripping the tag.
 * e.g. "llama3.1:latest" → "llama3.1"
 *      "phi3:latest"     → "phi3"
 */
function extractModelFamily(modelName: string): string | null {
  const colon = modelName.indexOf(":");
  return colon > 0 ? modelName.substring(0, colon) : modelName || null;
}

/**
 * Local Ollama models are free. Set input and output to 0; everything else null.
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
    const body = json as { models?: OllamaModel[] };
    const models = body?.models ?? [];
    return models.map((m) => ({
      modelId: m.name,
      rawMetadata: m as unknown as Record<string, unknown>,
    }));
  },

  classifyModel(modelId: string, _rawMetadata: unknown) {
    // Ollama provides no reliable modality or type data.
    // Strip the tag suffix and use ID-based classification.
    const bareId = extractModelFamily(modelId) ?? modelId;
    return classifyModel(bareId, {
      input: ["text"],
      output: ["text"],
    });
  },

  extractModelCard(modelId: string, rawMetadata: unknown): ModelCard {
    const raw = rawMetadata as OllamaModel;
    const bareId = extractModelFamily(modelId) ?? modelId;

    return {
      providerId: "ollama",
      modelId,
      displayName: modelId,
      description: "",
      createdAt: raw.modified_at ? new Date(raw.modified_at) : null,

      modelFamily: extractModelFamily(modelId),
      modelClass: classifyModel(bareId, {
        input: ["text"],
        output: ["text"],
      }),

      maxInputTokens: null,
      maxOutputTokens: null,

      inputModalities: ["text"],
      outputModalities: ["text"],

      capabilities: { ...EMPTY_CAPABILITIES },
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
