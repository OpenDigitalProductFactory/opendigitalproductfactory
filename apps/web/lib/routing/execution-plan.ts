/**
 * EP-INF-005b: Execution plan builder for the contract-based routing pipeline.
 *
 * Produces a RoutedExecutionPlan either from a matched ModelRecipe row
 * (buildPlanFromRecipe) or as a safe fallback default (buildDefaultPlan).
 *
 * See: docs/superpowers/specs/2026-03-20-contract-based-selection-design.md
 */

import type { RequestContract } from "./request-contract";
import type { EndpointManifest } from "./types";
import type { RecipeRow, RoutedExecutionPlan } from "./recipe-types";
import { usesResponsesApi, usesCliAdapter } from "./provider-utils";

// EP-INF-009c: Model class → execution adapter mapping
const MODEL_CLASS_ADAPTER: Record<string, string> = {
  chat: "chat",
  reasoning: "chat",
  image_gen: "image_gen",
  embedding: "embedding",
  audio: "transcription",
  code: "chat",
};

// ── buildPlanFromRecipe ──────────────────────────────────────────────────────

/**
 * Build an execution plan from a matched ModelRecipe row and the incoming
 * RequestContract.
 *
 * - Extracts max_tokens and temperature from providerSettings.
 * - Passes through any remaining providerSettings entries (e.g., reasoning_effort).
 * - Maps toolPolicy and responsePolicy directly from the recipe row.
 * - Sets recipeId to recipe.id.
 * - Defaults maxTokens to 4096 when providerSettings.max_tokens is absent.
 */
export function buildPlanFromRecipe(
  recipe: RecipeRow,
  contract: RequestContract,
): RoutedExecutionPlan {
  const settings =
    recipe.providerSettings !== null &&
    typeof recipe.providerSettings === "object"
      ? (recipe.providerSettings as Record<string, unknown>)
      : {};

  // Extract well-known keys, leave the rest as pass-through providerSettings
  const { max_tokens, temperature, ...remainingSettings } = settings as {
    max_tokens?: unknown;
    temperature?: unknown;
    [key: string]: unknown;
  };

  const maxTokens =
    typeof max_tokens === "number" && max_tokens > 0 ? max_tokens : 4096;

  const toolPolicy =
    recipe.toolPolicy !== null && typeof recipe.toolPolicy === "object"
      ? (recipe.toolPolicy as RoutedExecutionPlan["toolPolicy"])
      : {};

  const responsePolicy =
    recipe.responsePolicy !== null && typeof recipe.responsePolicy === "object"
      ? (recipe.responsePolicy as RoutedExecutionPlan["responsePolicy"])
      : {};

  // anthropic-sub uses OAuth tokens which only work with Claude CLI, not the
  // direct Messages API. Always route through CLI adapter for this provider.
  // MCP tool execution happens via the agentic loop, not the adapter itself.
  const executionAdapter = usesResponsesApi(recipe.providerId)
    ? "responses"
    : usesCliAdapter(recipe.providerId)
      ? "claude-cli"
      : (recipe.executionAdapter ?? "chat");

  const plan: RoutedExecutionPlan = {
    providerId: recipe.providerId,
    modelId: recipe.modelId,
    recipeId: recipe.id,
    contractFamily: recipe.contractFamily,
    executionAdapter,
    maxTokens,
    providerSettings: remainingSettings,
    toolPolicy,
    responsePolicy,
  };

  if (typeof temperature === "number") {
    plan.temperature = temperature;
  }

  return plan;
}

// ── buildDefaultPlan ─────────────────────────────────────────────────────────

/**
 * Build a safe fallback execution plan from an EndpointManifest and the
 * incoming RequestContract when no recipe matches.
 *
 * Defaults:
 * - maxTokens: 4096
 * - recipeId: null
 * - toolChoice: "auto" when contract.requiresTools, otherwise absent
 * - strictSchema: from contract.requiresStrictSchema
 * - stream: from contract.requiresStreaming
 */
export function buildDefaultPlan(
  endpoint: EndpointManifest,
  contract: RequestContract,
): RoutedExecutionPlan {
  const toolPolicy: RoutedExecutionPlan["toolPolicy"] = {};
  if (contract.requiresTools) {
    toolPolicy.toolChoice = "auto";
  }

  const responsePolicy: RoutedExecutionPlan["responsePolicy"] = {
    strictSchema: contract.requiresStrictSchema,
    stream: contract.requiresStreaming,
  };

  // EP-INF-009c: Select adapter based on required model class
  const adapterType = usesResponsesApi(endpoint.providerId)
    ? "responses"
    : usesCliAdapter(endpoint.providerId)
      ? "claude-cli"
      : contract.requiredModelClass
        ? (MODEL_CLASS_ADAPTER[contract.requiredModelClass] ?? "chat")
        : "chat";

  return {
    providerId: endpoint.providerId,
    modelId: endpoint.modelId,
    recipeId: null,
    contractFamily: contract.contractFamily,
    executionAdapter: adapterType,
    maxTokens: 4096,
    providerSettings: {},
    toolPolicy,
    responsePolicy,
  };
}
