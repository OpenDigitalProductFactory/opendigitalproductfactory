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
  imageInput: boolean | null;
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
  dimensionScoreSource: "provider" | "family_baseline" | "evaluated" | "production";
}

/** Empty capabilities — all null. */
export const EMPTY_CAPABILITIES: ModelCardCapabilities = {
  toolUse: null,
  structuredOutput: null,
  streaming: null,
  batch: null,
  citations: null,
  codeExecution: null,
  imageInput: null,
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
