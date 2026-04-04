/**
 * Known model catalog for providers that cannot be discovered via /v1/models.
 *
 * Codex and ChatGPT authenticate via OAuth subscription tokens that lack
 * platform API access, so autoDiscoverAndProfile() uses this catalog
 * instead of hitting the models endpoint.
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
      modelId: "gpt-5-codex",
      friendlyName: "GPT-5 Codex",
      summary:
        "OpenAI flagship Codex coding model -- advanced coding, reasoning, and tool use",
      qualityTier: "frontier",
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
      costTier: "$$$",
      bestFor: ["coding", "reasoning", "agentic-tasks"],
      avoidFor: ["conversation"],
      defaultStatus: "active",
      scores: {
        reasoning: 88,
        codegen: 96,
        toolFidelity: 90,
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
        "OpenAI Codex agentic coding model -- sandboxed execution with tool use",
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
      bestFor: ["coding", "agentic-tasks"],
      avoidFor: ["conversation"],
      defaultStatus: "disabled",
      retiredReason:
        "Codex Mini is not enabled by default for platform routing because it is CLI-oriented and often unavailable via the shared API path.",
      scores: {
        reasoning: 70,
        codegen: 90,
        toolFidelity: 85,
        instructionFollowingScore: 80,
        structuredOutputScore: 70,
        conversational: 40,
        contextRetention: 60,
      },
    },
  ],

  chatgpt: [
    {
      modelId: "gpt-5.4",
      friendlyName: "GPT-5.4 (ChatGPT Subscription)",
      summary:
        "OpenAI GPT-5.4 via ChatGPT subscription -- conversation, coding, reasoning",
      qualityTier: "frontier",
      capabilities: {
        ...EMPTY_CAPABILITIES,
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
      bestFor: ["conversation", "coding", "general-purpose", "reasoning"],
      avoidFor: ["local-only-required"],
      defaultStatus: "active",
      scores: {
        reasoning: 85,
        codegen: 90,
        toolFidelity: 85,
        instructionFollowingScore: 85,
        structuredOutputScore: 80,
        conversational: 80,
        contextRetention: 75,
      },
    },
  ],
};
