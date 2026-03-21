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
  providerSettings: unknown;
  toolPolicy: unknown;
  responsePolicy: unknown;
}
