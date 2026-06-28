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
  capabilityCategory: string;
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

const GROK_CORE_CAPABILITIES: ModelCardCapabilities = {
  ...EMPTY_CAPABILITIES,
  toolUse: true,
  streaming: true,
  structuredOutput: true,
  imageInput: true,
  thinking: true,
  promptCaching: true,
  effortLevels: ["none", "low", "medium", "high"],
};

const ZAI_GLM_CORE_CAPABILITIES: ModelCardCapabilities = {
  ...EMPTY_CAPABILITIES,
  toolUse: true,
  streaming: true,
  structuredOutput: true,
  thinking: true,
  contextManagement: true,
};

export const KNOWN_PROVIDER_MODELS: Record<string, KnownModel[]> = {
  zai: [
    {
      modelId: "glm-5.2",
      friendlyName: "GLM-5.2",
      summary:
        "Z.ai GLM-5.2 - long-context reasoning model with OpenAI-compatible tool calling and structured output",
      qualityTier: "frontier",
      capabilities: ZAI_GLM_CORE_CAPABILITIES,
      maxContextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      inputModalities: ["text"],
      outputModalities: ["text"],
      modelClass: "reasoning",
      modelFamily: "glm-5",
      capabilityCategory: "advanced",
      costTier: "$$",
      bestFor: ["reasoning", "long-context analysis", "tool-use", "structured output", "coding assistance"],
      avoidFor: ["offline or local-only data-residency tasks"],
      defaultStatus: "active",
      scores: {
        reasoning: 92,
        codegen: 90,
        toolFidelity: 88,
        instructionFollowingScore: 88,
        structuredOutputScore: 88,
        conversational: 86,
        contextRetention: 94,
      },
    },
  ],

  "zai-coding": [
    {
      modelId: "glm-5.2",
      friendlyName: "GLM-5.2 Coding",
      summary:
        "Z.ai GLM-5.2 via the GLM Coding endpoint - OpenCode-compatible coding model for Build Studio dispatch",
      qualityTier: "frontier",
      capabilities: ZAI_GLM_CORE_CAPABILITIES,
      maxContextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      inputModalities: ["text"],
      outputModalities: ["text"],
      modelClass: "code",
      modelFamily: "glm-5",
      capabilityCategory: "advanced",
      costTier: "$$",
      bestFor: ["agentic coding", "Build Studio tasks", "tool-use", "long-context codebase work"],
      avoidFor: ["offline or local-only builds"],
      defaultStatus: "active",
      scores: {
        reasoning: 90,
        codegen: 94,
        toolFidelity: 88,
        instructionFollowingScore: 88,
        structuredOutputScore: 88,
        conversational: 78,
        contextRetention: 94,
      },
    },
  ],

  "anthropic-sub": [
    {
      modelId: "claude-sonnet-4-6",
      friendlyName: "Claude Sonnet 4.6",
      summary:
        "Anthropic Claude Sonnet 4.6 -- strong reasoning, coding, and governed platform tool use through the Claude CLI adapter",
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
      capabilityCategory: "advanced",
      costTier: "$$",
      bestFor: ["code generation", "complex reasoning", "analysis", "platform tool use"],
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
        "Anthropic Claude Opus 4.6 -- deep reasoning and governed platform tool use through the Claude CLI adapter",
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
      capabilityCategory: "advanced",
      costTier: "$$$",
      bestFor: ["deep reasoning", "complex code", "architecture", "long context", "platform tool use"],
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
        "Anthropic Claude Haiku 4.5 -- fast general tasks and simple governed platform tool use through the Claude CLI adapter",
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
      capabilityCategory: "moderate",
      costTier: "$",
      bestFor: ["general purpose tasks", "fast responses", "simple platform tool use"],
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
        toolUse: false,
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
      capabilityCategory: "moderate",
      costTier: "$",
      bestFor: ["general purpose tasks"],
      avoidFor: ["complex tasks", "tool use via subscription"],
      defaultStatus: "retired",
      retiredReason:
        "Claude 3 Haiku returns empty responses via subscription OAuth — use Haiku 4.5 instead",
      scores: {
        reasoning: 55,
        codegen: 55,
        toolFidelity: 10,
        instructionFollowingScore: 55,
        structuredOutputScore: 52,
        conversational: 55,
        contextRetention: 52,
      },
    },
  ],

  xai: [
    {
      modelId: "grok-4.3",
      friendlyName: "Grok 4.3",
      summary:
        "xAI Grok 4.3 - flagship chat and reasoning model with strong tool calling and long-context support",
      qualityTier: "frontier",
      capabilities: GROK_CORE_CAPABILITIES,
      maxContextTokens: 1_000_000,
      maxOutputTokens: null,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      modelClass: "reasoning",
      modelFamily: "grok-4",
      capabilityCategory: "advanced",
      costTier: "$$",
      bestFor: ["reasoning", "analysis", "long-context tasks", "tool-use"],
      avoidFor: ["deterministic coding agents where Grok Build is preferred"],
      defaultStatus: "active",
      scores: {
        reasoning: 92,
        codegen: 86,
        toolFidelity: 90,
        instructionFollowingScore: 90,
        structuredOutputScore: 88,
        conversational: 90,
        contextRetention: 94,
      },
    },
    {
      modelId: "grok-build-0.1",
      friendlyName: "Grok Build 0.1",
      summary:
        "xAI Grok Build 0.1 - fast coding model trained for agentic coding workflows and Build Studio dispatch",
      qualityTier: "frontier",
      capabilities: GROK_CORE_CAPABILITIES,
      maxContextTokens: 256_000,
      maxOutputTokens: null,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      modelClass: "code",
      modelFamily: "grok-build",
      capabilityCategory: "advanced",
      costTier: "$$",
      bestFor: ["agentic coding", "web development", "Build Studio tasks", "tool-use"],
      avoidFor: ["general chat when Grok 4.3 is available"],
      defaultStatus: "active",
      scores: {
        reasoning: 88,
        codegen: 94,
        toolFidelity: 90,
        instructionFollowingScore: 88,
        structuredOutputScore: 88,
        conversational: 74,
        contextRetention: 86,
      },
    },
  ],

  codex: [
    {
      modelId: "gpt-5.3-codex",
      friendlyName: "GPT-5.3 Codex",
      summary:
        "OpenAI Codex coding model — routes to api.openai.com/v1/responses, supports custom function tools",
      qualityTier: "frontier",
      capabilities: {
        ...EMPTY_CAPABILITIES,
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
      capabilityCategory: "advanced",
      costTier: "$$$",
      bestFor: ["coding", "reasoning", "tool-use"],
      avoidFor: ["conversation"],
      defaultStatus: "active",
      scores: {
        reasoning: 88,
        codegen: 96,
        toolFidelity: 80,
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
      capabilityCategory: "advanced",
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
        "OpenAI GPT-5.4 via Codex — routes to api.openai.com/v1/responses, supports custom function tools",
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
      capabilityCategory: "advanced",
      costTier: "$$$$",
      bestFor: ["coding", "reasoning", "tool-use"],
      avoidFor: [],
      defaultStatus: "active",
      scores: {
        reasoning: 95,
        codegen: 97,
        toolFidelity: 80,
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
      capabilityCategory: "advanced",
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
