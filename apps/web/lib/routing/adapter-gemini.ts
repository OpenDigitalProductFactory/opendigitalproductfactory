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
/**
 * Unversioned Gemini aliases that Google has sunset for new users.
 * The model list API still returns them, but generateContent rejects
 * calls with "no longer available to new users".  We mark them as
 * deprecated at discovery time so the router never selects them.
 */
const GEMINI_SUNSET_ALIASES = new Set([
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
]);

/** Detect if a Gemini model is deprecated from its metadata. */
function detectGeminiDeprecation(raw: GeminiModel): boolean {
  const modelId = stripModelsPrefix(raw.name);
  // Known sunset aliases — still listed by API but rejected at call time
  if (GEMINI_SUNSET_ALIASES.has(modelId)) return true;
  const desc = (raw.description ?? "").toLowerCase();
  if (desc.includes("deprecated") || desc.includes("no longer available")) return true;
  // Models with no supported generation methods are effectively unusable
  if (raw.supportedGenerationMethods && raw.supportedGenerationMethods.length === 0) return true;
  // Models that don't support generateContent can't be called via our API path
  if (raw.supportedGenerationMethods && !raw.supportedGenerationMethods.includes("generateContent")) return true;
  return false;
}

function isEmbeddingOnly(methods: string[]): boolean {
  return methods.includes("embedContent") && !methods.includes("generateContent");
}

/**
 * Extract capabilities from Gemini model metadata.
 * toolUse is approximated from supportedGenerationMethods including "generateContent".
 */
function extractCapabilities(raw: GeminiModel): ModelCardCapabilities {
  const methods = raw.supportedGenerationMethods ?? [];
  const modelId = stripModelsPrefix(raw.name);
  const supportsGenerate = methods.includes("generateContent");

  const toolUse = supportsGenerate ? true : null;
  // All generateContent-capable models also support streaming
  const streaming = supportsGenerate || methods.includes("streamGenerateContent") ? true : null;

  // Code execution: Gemini 2.0+ models that support generateContent
  const codeExecution = supportsGenerate && /^gemini-2/.test(modelId) ? true : null;

  // Web search grounding: Gemini 1.5+ models that support generateContent
  const webSearch = supportsGenerate && /^gemini-(1\.5|2)/.test(modelId) ? true : null;

  return {
    ...EMPTY_CAPABILITIES,
    toolUse,
    streaming,
    codeExecution,
    webSearch,
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

      status: detectGeminiDeprecation(raw) ? "deprecated" : "active",
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
