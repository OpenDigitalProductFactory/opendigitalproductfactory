// apps/web/lib/routing/adapter-openai.ts
import type {
  ProviderAdapter,
  DiscoveredModelEntry,
} from "./adapter-interface";
import type { ModelCard } from "./model-card-types";
import {
  EMPTY_CAPABILITIES,
  EMPTY_PRICING,
  DEFAULT_DIMENSION_SCORES,
} from "./model-card-types";
import { classifyModel } from "./model-classifier";
import { computeMetadataHash } from "./metadata-hash";

// ── Internal types for raw OpenAI API data ─────────────────────────

interface OpenAIModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Format an OpenAI model ID into a human-readable display name.
 * Examples:
 *   "gpt-4o"                  → "GPT-4o"
 *   "o4-mini"                 → "O4-mini"
 *   "text-embedding-3-small"  → "Text-embedding-3-small"
 *   "dall-e-3"                → "DALL-E-3"
 *   "tts-1"                   → "TTS-1"
 *   "whisper-1"               → "Whisper-1"
 *   "omni-moderation-latest"  → "Omni-moderation-latest"
 */
function formatDisplayName(modelId: string): string {
  // Well-known special cases with established branding
  const brandedPrefixes: Array<[RegExp, string]> = [
    [/^gpt-/i, "GPT-"],
    [/^dall-e/i, "DALL-E"],
    [/^tts-/i, "TTS-"],
  ];

  for (const [pattern, brand] of brandedPrefixes) {
    if (pattern.test(modelId)) {
      // Replace only the matched prefix with the branded version
      const rest = modelId.replace(pattern, "");
      return brand + rest;
    }
  }

  // Default: capitalize first letter
  return modelId.charAt(0).toUpperCase() + modelId.slice(1);
}

// ── Adapter implementation ─────────────────────────────────────────────

export const openAIAdapter: ProviderAdapter = {
  providerId: "openai",

  parseDiscoveryResponse(json: unknown): DiscoveredModelEntry[] {
    const body = json as { data?: OpenAIModel[] };
    const models = body?.data ?? [];
    return models.map((m) => ({
      modelId: m.id,
      rawMetadata: m as unknown as Record<string, unknown>,
    }));
  },

  classifyModel(modelId: string, _rawMetadata: unknown) {
    // OpenAI provides no modality data; rely on ID-based classification
    return classifyModel(modelId, {
      input: ["text"],
      output: ["text"],
    });
  },

  extractModelCard(modelId: string, rawMetadata: unknown): ModelCard {
    const raw = rawMetadata as OpenAIModel & {
      // ChatGPT backend /backend-api/models fields
      source?: string;
      slug?: string;
      title?: string;
      description?: string;
      max_tokens?: number;
      capabilities?: Record<string, unknown>;
      tags?: string[];
    };

    const isChatGptDiscovery = raw.source === "chatgpt_backend_discovery";

    // Extract capabilities from ChatGPT backend metadata if available.
    // toolUse is intentionally false — the ChatGPT backend /codex/responses
    // endpoint only supports Codex's built-in tools, not custom function tools.
    const capabilities = { ...EMPTY_CAPABILITIES };
    if (isChatGptDiscovery) {
      capabilities.streaming = true;
    }

    return {
      providerId: "openai",
      modelId,
      displayName: raw.title ?? formatDisplayName(modelId),
      description: raw.description ?? "",
      createdAt: raw.created != null ? new Date(raw.created * 1000) : null,

      modelFamily: null,
      modelClass: classifyModel(modelId, {
        input: ["text"],
        output: ["text"],
      }),

      maxInputTokens: raw.max_tokens ?? null,
      maxOutputTokens: null,

      inputModalities: ["text"],
      outputModalities: ["text"],

      capabilities,
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

      metadataSource: isChatGptDiscovery ? "api" : "api",
      metadataConfidence: isChatGptDiscovery ? "medium" : "low",
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
