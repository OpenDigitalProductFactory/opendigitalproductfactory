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

  const plan: RoutedExecutionPlan = {
    providerId: recipe.providerId,
    modelId: recipe.modelId,
    recipeId: recipe.id,
    contractFamily: recipe.contractFamily,
    executionAdapter: recipe.executionAdapter ?? "chat",
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

  return {
    providerId: endpoint.providerId,
    modelId: endpoint.modelId,
    recipeId: null,
    contractFamily: contract.contractFamily,
    executionAdapter: "chat",
    maxTokens: 4096,
    providerSettings: {},
    toolPolicy,
    responsePolicy,
  };
}
