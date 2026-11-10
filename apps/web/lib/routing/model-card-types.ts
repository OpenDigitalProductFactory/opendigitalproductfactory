// apps/web/lib/routing/model-card-types.ts

/**
 * EP-INF-003: Canonical model metadata schema.
 * Captures everything providers publish about their models.
 */

export type ModelClass =
  | "chat"
  | "reasoning"
  | "embedding"
  | "image_gen"
  | "audio"
  | "video"
  | "moderation"
  | "speech"
  | "realtime"
  | "code";

export interface ModelCardCapabilities {
  toolUse: boolean | null;
  structuredOutput: boolean | null;
  streaming: boolean | null;
  batch: boolean | null;
  citations: boolean | null;
  codeExecution: boolean | null;
  webSearch: boolean | null;
  computerUse: boolean | null;
  imageInput: boolean | null;
  audioInput: boolean | null;
  pdfInput: boolean | null;
  thinking: boolean | null;
  adaptiveThinking: boolean | null;
  contextManagement: boolean | null;
  promptCaching: boolean | null;
  effortLevels: string[] | null;
}

export interface ModelCardPricing {
  inputPerMToken: number | null;
  outputPerMToken: number | null;
  cacheReadPerMToken: number | null;
  cacheWritePerMToken: number | null;
  imageInputPerMToken: number | null;
  imageOutputPerUnit: number | null;
  audioInputPerMToken: number | null;
  audioOutputPerMToken: number | null;
  reasoningPerMToken: number | null;
  requestFixed: number | null;
  webSearchPerRequest: number | null;
  /** OpenRouter discount multiplier (0.0-1.0, e.g., 0.5 = 50% off) */
  discount: number | null;
}

export interface ModelCardDimensionScores {
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  instructionFollowing: number;
  structuredOutput: number;
  conversational: number;
  contextRetention: number;
  custom: Record<string, number>;
}

export interface ModelCard {
  providerId: string;
  modelId: string;
  displayName: string;
  description: string;
  createdAt: Date | null;

  modelFamily: string | null;
  modelClass: ModelClass;

  maxInputTokens: number | null;
  maxOutputTokens: number | null;

  inputModalities: string[];
  outputModalities: string[];

  capabilities: ModelCardCapabilities;
  pricing: ModelCardPricing;

  supportedParameters: string[];
  defaultParameters: Record<string, unknown> | null;
  instructType: string | null;

  trainingDataCutoff: string | null;
  reliableKnowledgeCutoff: string | null;

  status: "active" | "degraded" | "deprecated" | "retired" | "preview";
  deprecationDate: Date | null;
  retiredAt: Date | null;

  perRequestLimits: {
    promptTokens: number | null;
    completionTokens: number | null;
  } | null;

  metadataSource: "api" | "curated" | "inferred";
  metadataConfidence: "high" | "medium" | "low";
  lastMetadataRefresh: Date;
  rawMetadataHash: string;

  dimensionScores: ModelCardDimensionScores;
  dimensionScoreSource: "inferred" | "provider" | "family_baseline" | "evaluated" | "production";

  /**
   * BI-1F5DAABC: vendor-published sampling guidance. Optional because a card
   * built before this existed carries none, and an absent profile must behave
   * exactly as it did then — provider defaults, nothing asserted.
   */
  sampling?: ModelCardSampling;
}

/**
 * BI-1F5DAABC: the sampling parameters a model's vendor documents for it.
 *
 * These live on the card rather than in a constant table in code because they
 * are the part of call configuration that decays: Qwen, DeepSeek and Hermes
 * publish required settings per release, and running at engine defaults instead
 * is a documented cause of repetition loops. Carrying them as discovered model
 * metadata means a new release arrives correct without a code change — the same
 * mechanism `no-provider-pinning` already relies on for model choice.
 *
 * A null profile means "this model publishes nothing" — not "use 0". Absent
 * values are left unset so the provider's own default applies.
 */
export interface SamplingProfile {
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  minP: number | null;
  repeatPenalty: number | null;
}

export interface ModelCardSampling {
  /** Vendor-recommended values for this model's normal (non-thinking) mode. */
  default: SamplingProfile | null;
  /** Vendor-recommended values when the model is reasoning/thinking. */
  thinking: SamplingProfile | null;
  /** Parameter names this model rejects (e.g. Anthropic: temperature with thinking on). */
  unsupported: string[];
  /**
   * Provenance, on the same ladder as `dimensionScoreSource`: a "seed" row is a
   * placeholder, a "catalog" row is curated, "operator" is an explicit local
   * override. Never treat a seed value as a measurement.
   */
  source: "catalog" | "discovered" | "operator" | "seed";
}

/** No published sampling guidance for this model. */
export const EMPTY_SAMPLING: ModelCardSampling = {
  default: null,
  thinking: null,
  unsupported: [],
  source: "seed",
};

/** A profile with nothing set — every value falls through to the provider default. */
export const EMPTY_SAMPLING_PROFILE: SamplingProfile = {
  temperature: null,
  topP: null,
  topK: null,
  minP: null,
  repeatPenalty: null,
};

/** Empty capabilities — all null. */
export const EMPTY_CAPABILITIES: ModelCardCapabilities = {
  toolUse: null,
  structuredOutput: null,
  streaming: null,
  batch: null,
  citations: null,
  codeExecution: null,
  webSearch: null,
  computerUse: null,
  imageInput: null,
  audioInput: null,
  pdfInput: null,
  thinking: null,
  adaptiveThinking: null,
  contextManagement: null,
  promptCaching: null,
  effortLevels: null,
};

/** Empty pricing — all null. */
export const EMPTY_PRICING: ModelCardPricing = {
  inputPerMToken: null,
  outputPerMToken: null,
  cacheReadPerMToken: null,
  cacheWritePerMToken: null,
  imageInputPerMToken: null,
  imageOutputPerUnit: null,
  audioInputPerMToken: null,
  audioOutputPerMToken: null,
  reasoningPerMToken: null,
  requestFixed: null,
  webSearchPerRequest: null,
  discount: null,
};

/** Default dimension scores — neutral 50 for all. */
export const DEFAULT_DIMENSION_SCORES: ModelCardDimensionScores = {
  reasoning: 50,
  codegen: 50,
  toolFidelity: 50,
  instructionFollowing: 50,
  structuredOutput: 50,
  conversational: 50,
  contextRetention: 50,
  custom: {},
};
