/**
 * Known model catalog — fallback for when dynamic discovery fails.
 *
 * Codex and ChatGPT now discover models dynamically via /backend-api/models.
 * This catalog is used only when:
 *   - OAuth token is not yet available (first activation)
 *   - The /backend-api/models endpoint is unreachable
 *   - The response is empty or unparseable
 *
 * Keep this catalog reasonably up-to-date as a safety net, but dynamic
 * discovery is the primary source of truth for model availability.
 */
import type { ModelCardCapabilities } from "./model-card-types";
import { EMPTY_CAPABILITIES } from "./model-card-types";
import type { QualityTier } from "./quality-tiers";

export interface KnownModel {
  modelId: string;
  friendlyName: string;
  summary: string;
  qualityTier: QualityTier;
  capabilities: ModelCardCapabilities;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  inputModalities: string[];
  outputModalities: string[];
  modelClass: string;
  modelFamily: string | null;
  capabilityTier: string;
  costTier: string;
  bestFor: string[];
  avoidFor: string[];
  defaultStatus: "active" | "disabled" | "retired";
  retiredReason?: string;
  scores?: {
    reasoning: number;
    codegen: number;
    toolFidelity: number;
    instructionFollowingScore: number;
    structuredOutputScore: number;
    conversational: number;
    contextRetention: number;
  };
}

export const KNOWN_PROVIDER_MODELS: Record<string, KnownModel[]> = {
  codex: [
    {
      modelId: "gpt-5.3-codex",
      friendlyName: "GPT-5.3 Codex",
      summary:
        "OpenAI Codex coding model -- uses built-in Codex tools, not custom function tools",
      qualityTier: "frontier",
      capabilities: {
        ...EMPTY_CAPABILITIES,
        // toolUse: false — Codex models via ChatGPT backend (/codex/responses)
        // only support Codex's built-in tools (apply_patch, shell, etc.), not
        // custom function tools. Setting toolUse=false prevents the routing
        // pipeline from selecting codex for tasks that need custom tools.
        toolUse: true,
        streaming: true,
        structuredOutput: true,
      },
      maxContextTokens: 400_000,
      maxOutputTokens: 128_000,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      modelClass: "code",
      modelFamily: "codex",
      capabilityTier: "advanced",
      costTier: "$$$",
      bestFor: ["coding", "reasoning"],
      avoidFor: ["conversation", "custom-tool-use"],
      defaultStatus: "active",
      scores: {
        reasoning: 88,
        codegen: 96,
        toolFidelity: 10,
        instructionFollowingScore: 86,
        structuredOutputScore: 84,
        conversational: 50,
        contextRetention: 78,
      },
    },
    {
      modelId: "codex-mini-latest",
      friendlyName: "Codex Mini",
      summary:
        "OpenAI Codex agentic coding model -- built-in Codex tools only",
      qualityTier: "strong",
      capabilities: {
        ...EMPTY_CAPABILITIES,
        toolUse: true,
        streaming: true,
        structuredOutput: true,
      },
      maxContextTokens: 128_000,
      maxOutputTokens: 16_384,
      inputModalities: ["text"],
      outputModalities: ["text"],
      modelClass: "code",
      modelFamily: "codex",
      capabilityTier: "advanced",
      costTier: "$$",
      bestFor: ["coding"],
      avoidFor: ["conversation", "custom-tool-use"],
      defaultStatus: "disabled",
      retiredReason:
        "Codex Mini is not enabled by default for platform routing because it is CLI-oriented and often unavailable via the shared API path.",
      scores: {
        reasoning: 70,
        codegen: 90,
        toolFidelity: 10,
        instructionFollowingScore: 80,
        structuredOutputScore: 70,
        conversational: 40,
        contextRetention: 60,
      },
    },
    {
      modelId: "gpt-5.4",
      friendlyName: "GPT-5.4 (Codex)",
      summary:
        "OpenAI flagship model via Codex -- built-in Codex tools only, not custom function tools",
      qualityTier: "frontier",
      capabilities: {
        ...EMPTY_CAPABILITIES,
        toolUse: true,
        streaming: true,
        structuredOutput: true,
      },
      maxContextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      modelClass: "code",
      modelFamily: "gpt-5",
      capabilityTier: "advanced",
      costTier: "$$$$",
      bestFor: ["coding", "reasoning"],
      avoidFor: ["custom-tool-use"],
      defaultStatus: "active",
      scores: {
        reasoning: 95,
        codegen: 97,
        toolFidelity: 10,
        instructionFollowingScore: 93,
        structuredOutputScore: 92,
        conversational: 85,
        contextRetention: 90,
      },
    },
  ],

  chatgpt: [
    {
      modelId: "gpt-5.4",
      friendlyName: "GPT-5.4 (ChatGPT Subscription)",
      summary:
        "OpenAI GPT-5.4 via ChatGPT subscription -- built-in tools only, not custom function tools",
      qualityTier: "frontier",
      capabilities: {
        ...EMPTY_CAPABILITIES,
        // toolUse: false — ChatGPT backend /codex/responses does not support
        // custom function tools. Only Codex's built-in tools work.
        toolUse: true,
        structuredOutput: true,
        streaming: true,
        imageInput: true,
      },
      maxContextTokens: 128_000,
      maxOutputTokens: 16_384,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      modelClass: "chat",
      modelFamily: "gpt-5",
      capabilityTier: "advanced",
      costTier: "subscription",
      bestFor: ["conversation", "coding", "reasoning"],
      avoidFor: ["custom-tool-use"],
      defaultStatus: "active",
      scores: {
        reasoning: 85,
        codegen: 90,
        toolFidelity: 10,
        instructionFollowingScore: 85,
        structuredOutputScore: 80,
        conversational: 80,
        contextRetention: 75,
      },
    },
  ],
};
