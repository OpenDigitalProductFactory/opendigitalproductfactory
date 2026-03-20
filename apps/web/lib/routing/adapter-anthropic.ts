// apps/web/lib/routing/adapter-anthropic.ts
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

// ── Internal types for raw Anthropic API data ─────────────────────────

interface AnthropicCapabilities {
  batch?: { supported?: boolean };
  citations?: { supported?: boolean };
  code_execution?: { supported?: boolean };
  context_management?: { supported?: boolean };
  effort?: Record<string, { supported?: boolean } | boolean>;
  image_input?: { supported?: boolean };
  pdf_input?: { supported?: boolean };
  structured_outputs?: { supported?: boolean };
  thinking?: {
    supported?: boolean;
    types?: {
      adaptive?: { supported?: boolean };
      enabled?: { supported?: boolean };
    };
  };
}

interface AnthropicModel {
  id: string;
  type?: string;
  display_name?: string;
  created_at?: string;
  max_input_tokens?: number;
  max_tokens?: number;
  capabilities?: AnthropicCapabilities;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Known effort level keys in canonical order. */
const EFFORT_LEVELS = ["low", "medium", "high", "max"] as const;

/**
 * Extract the model family from an Anthropic model ID.
 * e.g. "claude-opus-4-6" → "claude-opus-4"
 *      "claude-haiku-4-5-20251001" → "claude-haiku-4"
 *
 * Pattern: take up to and including the first numeric segment after
 * the sub-family name (opus, haiku, sonnet).
 */
function extractFamily(modelId: string): string | null {
  // Match: claude-<subfamily>-<major version digit(s)>
  const match = modelId.match(/^(claude-\w+-\d+)/);
  return match ? match[1] : null;
}

/**
 * Safely read a boolean at `obj.supported`, returning the value
 * or false when the path is missing.
 */
function isSupported(
  obj: { supported?: boolean } | undefined | null,
): boolean {
  return obj?.supported === true;
}

/**
 * Collect effort levels where `.supported === true` from the effort
 * capability object. Skips the top-level `supported` key.
 */
function extractEffortLevels(
  effort: AnthropicCapabilities["effort"] | undefined,
): string[] | null {
  if (!effort) return null;

  const levels: string[] = [];
  for (const level of EFFORT_LEVELS) {
    const entry = effort[level];
    if (entry && typeof entry === "object" && (entry as { supported?: boolean }).supported === true) {
      levels.push(level);
    }
  }
  return levels.length > 0 ? levels : null;
}

// ── Adapter implementation ─────────────────────────────────────────────

export const anthropicAdapter: ProviderAdapter = {
  providerId: "anthropic",

  parseDiscoveryResponse(json: unknown): DiscoveredModelEntry[] {
    const body = json as { data?: AnthropicModel[] };
    const models = body?.data ?? [];
    return models.map((m) => ({
      modelId: m.id,
      rawMetadata: m as unknown as Record<string, unknown>,
    }));
  },

  classifyModel(modelId: string, _rawMetadata: unknown) {
    // All Anthropic models returned by the models API are chat models.
    // We still run through the classifier for consistency, but Anthropic
    // doesn't expose modalities in their API — default to text→text.
    return classifyModel(modelId, {
      input: ["text"],
      output: ["text"],
    });
  },

  extractModelCard(modelId: string, rawMetadata: unknown): ModelCard {
    const raw = rawMetadata as AnthropicModel;
    const caps = raw.capabilities;

    return {
      providerId: "anthropic",
      modelId,
      displayName: raw.display_name ?? modelId,
      description: "",
      createdAt: raw.created_at ? new Date(raw.created_at) : null,

      modelFamily: extractFamily(modelId),
      modelClass: classifyModel(modelId, {
        input: ["text"],
        output: ["text"],
      }),

      maxInputTokens: raw.max_input_tokens ?? null,
      maxOutputTokens: raw.max_tokens ?? null,

      // Anthropic API does not expose modalities; default to text
      inputModalities: ["text"],
      outputModalities: ["text"],

      capabilities: {
        ...EMPTY_CAPABILITIES,
        // From API nested paths
        structuredOutput: isSupported(caps?.structured_outputs),
        batch: isSupported(caps?.batch),
        citations: isSupported(caps?.citations),
        codeExecution: isSupported(caps?.code_execution),
        imageInput: isSupported(caps?.image_input),
        pdfInput: isSupported(caps?.pdf_input),
        thinking: isSupported(caps?.thinking),
        adaptiveThinking: isSupported(caps?.thinking?.types?.adaptive),
        contextManagement: isSupported(caps?.context_management),
        effortLevels: extractEffortLevels(caps?.effort),
        // Curated — all Anthropic chat models support these
        toolUse: true,
        streaming: true,
        promptCaching: true,
      },

      // Pricing not available from Anthropic API
      pricing: { ...EMPTY_PRICING },

      supportedParameters: [],
      defaultParameters: null,
      instructType: null,

      // Training cutoffs not in API
      trainingDataCutoff: null,
      reliableKnowledgeCutoff: null,

      status: "active",
      deprecationDate: null,
      retiredAt: null,

      perRequestLimits: null,

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
