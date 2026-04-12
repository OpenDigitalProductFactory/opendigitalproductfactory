// apps/web/lib/routing/adapter-registry.ts
import type { ProviderAdapter } from "./adapter-interface";
import type { ModelCard } from "./model-card-types";
import { DEFAULT_DIMENSION_SCORES, EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import { getBaselineForModel } from "./family-baselines";
import { computeMetadataHash } from "./metadata-hash";
import { classifyModel } from "./model-classifier";
import { KNOWN_PROVIDER_MODELS } from "./known-provider-models";
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
  // Prefer live-discovered metadata over the static known catalog.
  // The known catalog is a fallback for providers that can't be queried dynamically.
  // If rawMetadata.source indicates live discovery, use the adapter to extract
  // capabilities from what the provider actually reported.
  const metadata = (typeof rawMetadata === "object" && rawMetadata !== null && !Array.isArray(rawMetadata))
    ? rawMetadata as Record<string, unknown>
    : null;
  const isLiveDiscovery = metadata?.source != null && metadata.source !== "known_catalog";

  const adapter = getAdapter(providerId);
  let card: ModelCard;

  if (isLiveDiscovery && adapter) {
    card = adapter.extractModelCard(modelId, rawMetadata);
  } else {
    const knownCatalogCard = buildKnownCatalogCard(providerId, modelId, rawMetadata);
    if (knownCatalogCard) {
      return knownCatalogCard;
    }
    card = adapter
      ? adapter.extractModelCard(modelId, rawMetadata)
      : buildFallbackCard(providerId, modelId, rawMetadata);
  }

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

function buildKnownCatalogCard(
  providerId: string,
  modelId: string,
  rawMetadata: unknown,
): ModelCard | null {
  const metadata = (typeof rawMetadata === "object" && rawMetadata !== null && !Array.isArray(rawMetadata))
    ? rawMetadata as Record<string, unknown>
    : null;
  if (metadata?.source !== "known_catalog") {
    return null;
  }

  const knownModel = KNOWN_PROVIDER_MODELS[providerId]?.find((model) => model.modelId === modelId);
  if (!knownModel) {
    return null;
  }

  const dimensionScores = knownModel.scores
    ? {
        reasoning: knownModel.scores.reasoning,
        codegen: knownModel.scores.codegen,
        toolFidelity: knownModel.scores.toolFidelity,
        instructionFollowing: knownModel.scores.instructionFollowingScore,
        structuredOutput: knownModel.scores.structuredOutputScore,
        conversational: knownModel.scores.conversational,
        contextRetention: knownModel.scores.contextRetention,
        custom: {},
      }
    : { ...DEFAULT_DIMENSION_SCORES };

  return {
    providerId,
    modelId,
    displayName: knownModel.friendlyName,
    description: knownModel.summary,
    createdAt: null,
    modelFamily: knownModel.modelFamily,
    modelClass: knownModel.modelClass as ModelCard["modelClass"],
    maxInputTokens: knownModel.maxContextTokens,
    maxOutputTokens: knownModel.maxOutputTokens,
    inputModalities: knownModel.inputModalities,
    outputModalities: knownModel.outputModalities,
    capabilities: knownModel.capabilities,
    pricing: { ...EMPTY_PRICING },
    supportedParameters: [],
    defaultParameters: null,
    instructType: null,
    trainingDataCutoff: null,
    reliableKnowledgeCutoff: null,
    status: knownModel.defaultStatus === "disabled" ? "degraded" : knownModel.defaultStatus,
    deprecationDate: null,
    retiredAt: knownModel.defaultStatus === "retired" ? new Date() : null,
    perRequestLimits: null,
    metadataSource: "curated",
    metadataConfidence: "medium",
    lastMetadataRefresh: new Date(),
    rawMetadataHash: computeMetadataHash(rawMetadata),
    dimensionScores,
    dimensionScoreSource: "family_baseline",
  };
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
