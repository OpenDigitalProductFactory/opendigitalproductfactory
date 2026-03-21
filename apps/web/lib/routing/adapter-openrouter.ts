// apps/web/lib/routing/adapter-openrouter.ts
import type {
  ProviderAdapter,
  DiscoveredModelEntry,
} from "./adapter-interface";
import type {
  ModelCard,
  ModelCardCapabilities,
  ModelCardPricing,
} from "./model-card-types";
import {
  EMPTY_CAPABILITIES,
  EMPTY_PRICING,
  DEFAULT_DIMENSION_SCORES,
} from "./model-card-types";
import { classifyModel } from "./model-classifier";
import { computeMetadataHash } from "./metadata-hash";

// ── Internal types for raw OpenRouter API data ─────────────────────────

interface ORPricing {
  prompt?: string;
  completion?: string;
  request?: string;
  image?: string;
  image_token?: string;
  image_output?: string;
  audio?: string;
  audio_output?: string;
  input_audio_cache?: string;
  web_search?: string;
  internal_reasoning?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  discount?: number;
}

interface ORArchitecture {
  tokenizer?: string | null;
  instruct_type?: string | null;
  modality?: string;
  input_modalities?: string[];
  output_modalities?: string[];
}

interface ORTopProvider {
  context_length?: number | null;
  max_completion_tokens?: number | null;
  is_moderated?: boolean;
}

interface ORPerRequestLimits {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}

interface ORModel {
  id: string;
  name?: string;
  created?: number | null;
  description?: string;
  pricing?: ORPricing;
  context_length?: number | null;
  architecture?: ORArchitecture;
  top_provider?: ORTopProvider;
  per_request_limits?: ORPerRequestLimits | null;
  supported_parameters?: string[];
  default_parameters?: Record<string, unknown> | null;
  expiration_date?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Convert OpenRouter per-token string price to per-million-tokens number.
 * Returns null for missing, undefined, or zero values (zero = not applicable).
 */
function tokenPriceToPerMillion(value: string | undefined | null): number | null {
  if (value == null) return null;
  const n = parseFloat(value);
  if (isNaN(n) || n === 0) return null;
  return n * 1_000_000;
}

/**
 * Extract the provider family from an OpenRouter model ID (e.g., "anthropic/claude-sonnet-4-6" → "anthropic").
 */
function extractFamily(modelId: string): string | null {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.substring(0, slash) : null;
}

/**
 * Strip provider prefix for classifier (e.g., "openai/o4-mini" → "o4-mini").
 */
function stripPrefix(modelId: string): string {
  const slash = modelId.indexOf("/");
  return slash > 0 ? modelId.substring(slash + 1) : modelId;
}

// ── Adapter implementation ─────────────────────────────────────────────

function extractCapabilities(
  supportedParams: string[],
  inputModalities: string[],
  pricing?: ORPricing,
): ModelCardCapabilities {
  if (supportedParams.length === 0) {
    return { ...EMPTY_CAPABILITIES };
  }

  const hasParam = (p: string) => supportedParams.includes(p);

  // webSearch: true if the model has non-zero web_search pricing (indicates support)
  const webSearchPrice = pricing?.web_search ? parseFloat(pricing.web_search) : 0;
  const webSearch = webSearchPrice > 0 ? true : null;

  return {
    ...EMPTY_CAPABILITIES,
    toolUse: hasParam("tools") ? true : null,
    structuredOutput: hasParam("structured_outputs") ? true : null,
    streaming: hasParam("stream") ? true : null,
    imageInput: inputModalities.includes("image") ? true : null,
    pdfInput: inputModalities.includes("file") ? true : null,
    webSearch,
  };
}

function extractPricing(raw: ORPricing | undefined): ModelCardPricing {
  if (!raw) return { ...EMPTY_PRICING };

  return {
    inputPerMToken: tokenPriceToPerMillion(raw.prompt),
    outputPerMToken: tokenPriceToPerMillion(raw.completion),
    cacheReadPerMToken: tokenPriceToPerMillion(raw.input_cache_read),
    cacheWritePerMToken: tokenPriceToPerMillion(raw.input_cache_write),
    imageInputPerMToken: tokenPriceToPerMillion(raw.image_token),
    imageOutputPerUnit: tokenPriceToPerMillion(raw.image_output),
    audioInputPerMToken: tokenPriceToPerMillion(raw.audio),
    audioOutputPerMToken: tokenPriceToPerMillion(raw.audio_output),
    reasoningPerMToken: tokenPriceToPerMillion(raw.internal_reasoning),
    requestFixed: tokenPriceToPerMillion(raw.request),
    webSearchPerRequest: tokenPriceToPerMillion(raw.web_search),
    discount: raw.discount ?? null,
  };
}

export const openRouterAdapter: ProviderAdapter = {
  providerId: "openrouter",

  parseDiscoveryResponse(json: unknown): DiscoveredModelEntry[] {
    const body = json as { data?: ORModel[] };
    const models = body?.data ?? [];
    return models.map((m) => ({
      modelId: m.id,
      rawMetadata: m as unknown as Record<string, unknown>,
    }));
  },

  classifyModel(modelId: string, rawMetadata: unknown) {
    const raw = rawMetadata as ORModel;
    const arch = raw.architecture;
    const inputModalities = arch?.input_modalities ?? ["text"];
    const outputModalities = arch?.output_modalities ?? ["text"];
    return classifyModel(stripPrefix(modelId), {
      input: inputModalities,
      output: outputModalities,
    });
  },

  extractModelCard(modelId: string, rawMetadata: unknown): ModelCard {
    const raw = rawMetadata as ORModel;
    const arch = raw.architecture;
    const topProvider = raw.top_provider;
    const inputModalities = arch?.input_modalities ?? ["text"];
    const outputModalities = arch?.output_modalities ?? ["text"];
    const supportedParams = raw.supported_parameters ?? [];

    const maxCompletionTokens = topProvider?.max_completion_tokens ?? null;

    return {
      providerId: "openrouter",
      modelId,
      displayName: raw.name ?? modelId,
      description: raw.description ?? "",
      createdAt:
        raw.created != null ? new Date(raw.created * 1000) : null,

      modelFamily: extractFamily(modelId),
      modelClass: classifyModel(stripPrefix(modelId), {
        input: inputModalities,
        output: outputModalities,
      }),

      maxInputTokens: raw.context_length ?? null,
      maxOutputTokens: maxCompletionTokens,

      inputModalities,
      outputModalities,

      capabilities: extractCapabilities(supportedParams, inputModalities, raw.pricing),
      pricing: extractPricing(raw.pricing),

      supportedParameters: supportedParams,
      defaultParameters: raw.default_parameters ?? null,
      instructType: arch?.instruct_type ?? null,

      trainingDataCutoff: null,
      reliableKnowledgeCutoff: null,

      status: raw.expiration_date ? "deprecated" : "active",
      deprecationDate: raw.expiration_date
        ? new Date(raw.expiration_date)
        : null,
      retiredAt: null,

      perRequestLimits: raw.per_request_limits
        ? {
            promptTokens: raw.per_request_limits.prompt_tokens ?? null,
            completionTokens:
              raw.per_request_limits.completion_tokens ?? null,
          }
        : null,

      metadataSource: "api",
      metadataConfidence: "high",
      lastMetadataRefresh: new Date(),
      rawMetadataHash: computeMetadataHash(rawMetadata),

      dimensionScores: { ...DEFAULT_DIMENSION_SCORES },
      dimensionScoreSource: "inferred",
    };
  },

  metadataConfidence(_rawMetadata: unknown) {
    return "high";
  },
};
