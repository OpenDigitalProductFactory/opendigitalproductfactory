// apps/web/lib/routing/adapter-interface.ts
import type { ModelCard, ModelClass } from "./model-card-types";

export interface DiscoveredModelEntry {
  modelId: string;
  rawMetadata: Record<string, unknown>;
}

/**
 * EP-INF-003: Per-provider adapter that maps raw API responses to ModelCard.
 */
export interface ProviderAdapter {
  readonly providerId: string;

  /** Parse the provider's discovery API response into individual model entries.
   *  Replaces the shared parseModelsResponse() in ai-provider-types.ts
   *  which currently handles all providers in one function. Each adapter
   *  owns its own parsing logic. The shared function is removed. */
  parseDiscoveryResponse(json: unknown): DiscoveredModelEntry[];

  /** Extract a ModelCard from a single model's raw metadata. */
  extractModelCard(modelId: string, rawMetadata: unknown): ModelCard;

  /** Classify the model by type. */
  classifyModel(modelId: string, rawMetadata: unknown): ModelClass;

  /** Overall confidence based on how much the provider API reveals. */
  metadataConfidence(rawMetadata: unknown): "high" | "medium" | "low";
}
