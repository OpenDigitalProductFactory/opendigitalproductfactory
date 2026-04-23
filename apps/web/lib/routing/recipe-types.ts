/**
 * EP-INF-005b: Recipe types for the contract-based routing pipeline.
 *
 * RecipeRow mirrors the database shape for a ModelRecipe row.
 * RoutedExecutionPlan is the fully resolved, provider-ready execution plan
 * produced by the execution plan builder from a recipe (or as a fallback default).
 *
 * See: docs/superpowers/specs/2026-03-20-contract-based-selection-design.md
 */

// ── RoutedExecutionPlan ──────────────────────────────────────────────────────

export interface RoutedExecutionPlan {
  providerId: string;
  modelId: string;
  recipeId: string | null;
  contractFamily: string;
  executionAdapter: string;
  maxTokens: number;
  temperature?: number;
  providerSettings: Record<string, unknown>;
  toolPolicy: {
    toolChoice?: "auto" | "required" | "none";
    allowParallelToolCalls?: boolean;
  };
  responsePolicy: {
    strictSchema?: boolean;
    stream?: boolean;
  };
}

// ── RecipeRow ────────────────────────────────────────────────────────────────

export interface RecipeRow {
  id: string;
  providerId: string;
  modelId: string;
  contractFamily: string;
  version: number;
  status: string;
  origin: string;
  executionAdapter: string;
  providerSettings: unknown;
  toolPolicy: unknown;
  responsePolicy: unknown;
}

// ── RoleRoutingRecipe ────────────────────────────────────────────────────────
//
// Lightweight preference hint that lets deliberation branch roles (reviewer,
// skeptic, adjudicator, debater, ...) express what kind of model they want
// WITHOUT bypassing the existing task-router pipeline. The router still owns
// endpoint selection and recipe binding — this just rides alongside the
// request so branches can ask for e.g. a high-tier synthesis model for an
// adjudicator role or a diverse provider for a skeptic.
//
// Populated from DeliberationPattern.providerStrategyHints.rolesRecipes by
// the deliberation registry. Read by callers via loadRoleRecipe() in
// recipe-loader.ts.

export interface RoleRoutingRecipe {
  roleId: string;
  capabilityTier?: "low" | "medium" | "high";
  taskType?: string;
  preferProviderDiversity?: boolean;
  requireProviderDiversity?: boolean;
}
