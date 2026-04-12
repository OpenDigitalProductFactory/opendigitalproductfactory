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
  "anthropic-sub": [
    {
      modelId: "claude-sonnet-4-6",
      friendlyName: "Claude Sonnet 4.6",
      summary:
        "Anthropic Claude Sonnet 4.6 — best balance of speed and capability for code and tool use",
      qualityTier: "frontier",
      capabilities: {
        ...EMPTY_CAPABILITIES,
        toolUse: true,
        streaming: true,
        structuredOutput: true,
        imageInput: true,
        pdfInput: true,
        thinking: true,
        citations: true,
        promptCaching: true,
        contextManagement: true,
      },
      maxContextTokens: 200_000,
      maxOutputTokens: 32_000,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      modelClass: "chat",
      modelFamily: "claude-4",
      capabilityTier: "advanced",
      costTier: "$$",
      bestFor: ["code generation", "tool use", "complex reasoning", "analysis"],
      avoidFor: [],
      defaultStatus: "active",
      scores: {
        reasoning: 95,
        codegen: 95,
        toolFidelity: 95,
        instructionFollowingScore: 95,
        structuredOutputScore: 93,
        conversational: 95,
        contextRetention: 95,
      },
    },
    {
      modelId: "claude-opus-4-6",
      friendlyName: "Claude Opus 4.6",
      summary:
        "Anthropic Claude Opus 4.6 — most capable model for deep reasoning and complex tasks",
      qualityTier: "frontier",
      capabilities: {
        ...EMPTY_CAPABILITIES,
        toolUse: true,
        streaming: true,
        structuredOutput: true,
        imageInput: true,
        pdfInput: true,
        thinking: true,
        citations: true,
        promptCaching: true,
        contextManagement: true,
      },
      maxContextTokens: 200_000,
      maxOutputTokens: 32_000,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      modelClass: "chat",
      modelFamily: "claude-4",
      capabilityTier: "advanced",
      costTier: "$$$",
      bestFor: ["deep reasoning", "complex code", "architecture", "long context"],
      avoidFor: [],
      defaultStatus: "active",
      scores: {
        reasoning: 95,
        codegen: 95,
        toolFidelity: 95,
        instructionFollowingScore: 95,
        structuredOutputScore: 93,
        conversational: 95,
        contextRetention: 95,
      },
    },
    {
      modelId: "claude-haiku-4-5-20251001",
      friendlyName: "Claude Haiku 4.5",
      summary:
        "Anthropic Claude Haiku 4.5 — fast and affordable for general tasks",
      qualityTier: "strong",
      capabilities: {
        ...EMPTY_CAPABILITIES,
        toolUse: true,
        streaming: true,
        structuredOutput: true,
        imageInput: true,
        pdfInput: true,
        thinking: true,
        citations: true,
        promptCaching: true,
        contextManagement: true,
      },
      maxContextTokens: 200_000,
      maxOutputTokens: 8_192,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      modelClass: "chat",
      modelFamily: "claude-haiku-4",
      capabilityTier: "moderate",
      costTier: "$",
      bestFor: ["general purpose tasks", "fast responses", "simple tool use"],
      avoidFor: ["complex code generation", "deep reasoning"],
      defaultStatus: "active",
      scores: {
        reasoning: 75,
        codegen: 75,
        toolFidelity: 75,
        instructionFollowingScore: 75,
        structuredOutputScore: 72,
        conversational: 75,
        contextRetention: 72,
      },
    },
    {
      modelId: "claude-3-haiku-20240307",
      friendlyName: "Claude Haiku 3",
      summary:
        "Anthropic Claude Haiku 3 — legacy model, returns empty via subscription OAuth",
      qualityTier: "adequate",
      capabilities: {
        ...EMPTY_CAPABILITIES,
        toolUse: true,
        streaming: true,
        imageInput: true,
        promptCaching: true,
      },
      maxContextTokens: 200_000,
      maxOutputTokens: 4_096,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      modelClass: "chat",
      modelFamily: "claude-3",
      capabilityTier: "moderate",
      costTier: "$",
      bestFor: ["general purpose tasks"],
      avoidFor: ["complex tasks", "tool use via subscription"],
      defaultStatus: "retired",
      retiredReason:
        "Claude 3 Haiku returns empty responses via subscription OAuth — use Haiku 4.5 instead",
      scores: {
        reasoning: 55,
        codegen: 55,
        toolFidelity: 55,
        instructionFollowingScore: 55,
        structuredOutputScore: 52,
        conversational: 55,
        contextRetention: 52,
      },
    },
  ],

  codex: [
    {
      modelId: "gpt-5.3-codex",
      friendlyName: "GPT-5.3 Codex",
      summary:
        "OpenAI Codex coding model -- uses built-in Codex tools, not custom function tools",
      qualityTier: "frontier",
      capabilities: {
        ...EMPTY_CAPABILITIES,
        // Codex models via ChatGPT backend (/codex/responses) only support
        // Codex's built-in tools (apply_patch, shell, etc.), not custom
        // function tools — mark false so the router never selects codex
        // for tasks that need custom tools.
        toolUse: false,
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
        // ChatGPT backend /codex/responses does not support custom function
        // tools. Only Codex's built-in tools work — mark false so the router
        // never selects this endpoint when tools are required.
        toolUse: false,
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
