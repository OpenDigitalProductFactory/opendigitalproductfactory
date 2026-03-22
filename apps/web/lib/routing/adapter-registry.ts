// apps/web/lib/routing/adapter-registry.ts
import type { ProviderAdapter } from "./adapter-interface";
import type { ModelCard } from "./model-card-types";
import { DEFAULT_DIMENSION_SCORES, EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import { getBaselineForModel } from "./family-baselines";
import { computeMetadataHash } from "./metadata-hash";
import { classifyModel } from "./model-classifier";
import { anthropicAdapter } from "./adapter-anthropic";
import { openRouterAdapter } from "./adapter-openrouter";
import { openAIAdapter } from "./adapter-openai";
import { geminiAdapter } from "./adapter-gemini";
import { ollamaAdapter } from "./adapter-ollama";

const ADAPTERS: Record<string, ProviderAdapter> = {
  openrouter: openRouterAdapter,
  anthropic: anthropicAdapter,
  "anthropic-sub": anthropicAdapter,
  openai: openAIAdapter,
  chatgpt: openAIAdapter,
  codex: openAIAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter,
};

export function getAdapter(providerId: string): ProviderAdapter | null {
  return ADAPTERS[providerId] ?? null;
}

/**
 * Extract ModelCard using the appropriate adapter, then fill gaps
 * from family baselines. Dimension scores are always fully populated.
 */
export function extractModelCardWithFallback(
  providerId: string,
  modelId: string,
  rawMetadata: unknown,
): ModelCard {
  const adapter = getAdapter(providerId);
  const card = adapter
    ? adapter.extractModelCard(modelId, rawMetadata)
    : buildFallbackCard(providerId, modelId, rawMetadata);

  // Fill dimension scores from family baseline if adapter left them at defaults.
  const baseline = getBaselineForModel(modelId);
  if (baseline && card.dimensionScoreSource === "inferred") {
    card.dimensionScores = { ...baseline.scores, custom: {} };
    card.dimensionScoreSource = "family_baseline";
    if (card.metadataConfidence === "low" && baseline.confidence === "medium") {
      card.metadataConfidence = "medium";
    }
  }

  return card;
}

function buildFallbackCard(
  providerId: string,
  modelId: string,
  rawMetadata: unknown,
): ModelCard {
  return {
    providerId,
    modelId,
    displayName: modelId,
    description: "",
    createdAt: null,
    modelFamily: null,
    modelClass: classifyModel(modelId, { input: ["text"], output: ["text"] }),
    maxInputTokens: null,
    maxOutputTokens: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: { ...EMPTY_CAPABILITIES },
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
    metadataSource: "inferred",
    metadataConfidence: "low",
    lastMetadataRefresh: new Date(),
    rawMetadataHash: computeMetadataHash(rawMetadata),
    dimensionScores: { ...DEFAULT_DIMENSION_SCORES },
    dimensionScoreSource: "inferred",
  };
}
