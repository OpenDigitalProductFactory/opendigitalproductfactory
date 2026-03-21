// apps/web/lib/routing/recipe-seeder.ts

/**
 * EP-INF-005b: Seed recipe builder.
 *
 * Pure function that derives provider-specific settings, tool policy, and
 * response policy from a model card and request contract. No DB interaction.
 */

import type { ModelCardCapabilities } from "./model-card-types";
import { isAnthropic, isOpenAI } from "./provider-utils";

// ── Constants ────────────────────────────────────────────────────────────────

const THINKING_BUDGETS: Record<string, number> = {
  medium: 4096,
  high: 8192,
};

const REASONING_EFFORT_MAP: Record<string, string> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

const OPENAI_CHAT_TEMPERATURE: Record<string, number> = {
  minimize_cost: 0.3,
  balanced: 0.7,
  quality_first: 1.0,
};

// ── Core ─────────────────────────────────────────────────────────────────────

export function buildSeedRecipe(
  providerId: string,
  _modelId: string,
  _contractFamily: string,
  modelCard: {
    capabilities: ModelCardCapabilities;
    maxOutputTokens: number | null;
    modelClass: string;
  },
  contract: {
    estimatedOutputTokens: number;
    reasoningDepth: string;
    budgetClass: string;
    requiresTools: boolean;
    requiresStrictSchema: boolean;
    requiresStreaming: boolean;
  },
): {
  providerSettings: Record<string, unknown>;
  toolPolicy: Record<string, unknown>;
  responsePolicy: Record<string, unknown>;
} {
  const maxTokens = deriveMaxTokens(
    contract.estimatedOutputTokens,
    modelCard.maxOutputTokens,
  );

  const providerSettings = buildProviderSettings(
    providerId,
    modelCard,
    contract,
    maxTokens,
  );

  const toolPolicy = {
    toolChoice: contract.requiresTools ? "auto" : undefined,
    allowParallelToolCalls: true,
  };

  const responsePolicy = {
    strictSchema: contract.requiresStrictSchema,
    stream: contract.requiresStreaming,
  };

  return { providerSettings, toolPolicy, responsePolicy };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function deriveMaxTokens(
  estimatedOutputTokens: number,
  modelMaxOutputTokens: number | null,
): number {
  const cap = modelMaxOutputTokens ?? 4096;
  return Math.min(Math.max(estimatedOutputTokens * 2, 1024), cap);
}

function buildProviderSettings(
  providerId: string,
  modelCard: {
    capabilities: ModelCardCapabilities;
    maxOutputTokens: number | null;
    modelClass: string;
  },
  contract: {
    estimatedOutputTokens: number;
    reasoningDepth: string;
    budgetClass: string;
  },
  maxTokens: number,
): Record<string, unknown> {
  const settings: Record<string, unknown> = { max_tokens: maxTokens };

  if (isAnthropic(providerId)) {
    applyAnthropicSettings(settings, modelCard.capabilities, contract.reasoningDepth, maxTokens);
  } else if (isOpenAI(providerId) && modelCard.modelClass === "reasoning") {
    applyOpenAIReasoningSettings(settings, contract.reasoningDepth);
  } else if (isOpenAI(providerId) && modelCard.modelClass !== "reasoning") {
    applyOpenAIChatSettings(settings, contract.budgetClass);
  } else if (providerId === "ollama") {
    settings.keep_alive = -1;
  }
  // Generic fallback: just max_tokens (already set)

  return settings;
}

function applyAnthropicSettings(
  settings: Record<string, unknown>,
  capabilities: ModelCardCapabilities,
  reasoningDepth: string,
  outputMaxTokens: number,
): void {
  if (
    reasoningDepth === "medium" &&
    capabilities.adaptiveThinking === true
  ) {
    settings.thinking = { type: "adaptive" };
    // Adaptive thinking manages its own budget — no max_tokens adjustment needed
  } else if (
    (reasoningDepth === "medium" || reasoningDepth === "high") &&
    capabilities.thinking === true
  ) {
    const budgetTokens = THINKING_BUDGETS[reasoningDepth] ?? 4096;
    settings.thinking = {
      type: "enabled",
      budget_tokens: budgetTokens,
    };
    // Anthropic requires max_tokens >= budget_tokens + actual output tokens
    settings.max_tokens = outputMaxTokens + budgetTokens;
  }
  // No temperature — Anthropic defaults are good
}

function applyOpenAIReasoningSettings(
  settings: Record<string, unknown>,
  reasoningDepth: string,
): void {
  const effort = REASONING_EFFORT_MAP[reasoningDepth];
  if (effort) {
    settings.reasoning_effort = effort;
  }
}

function applyOpenAIChatSettings(
  settings: Record<string, unknown>,
  budgetClass: string,
): void {
  const temp = OPENAI_CHAT_TEMPERATURE[budgetClass];
  if (temp !== undefined) {
    settings.temperature = temp;
  }
}
