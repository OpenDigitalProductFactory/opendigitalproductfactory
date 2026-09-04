/**
 * EP-INF-005b: Recipe types for the contract-based routing pipeline.
 *
 * RecipeRow mirrors the database shape for a ModelRecipe row.
 * RoutedExecutionPlan is the fully resolved, provider-ready execution plan
 * produced by the execution plan builder from a recipe (or as a fallback default).
 *
 * See: docs/superpowers/specs/2026-03-20-contract-based-selection-design.md
 */

import type {
  AdapterCapabilityRequirement,
  ExecutionAdapterSelector,
} from "./execution-adapter-types";
import type { ActivityClass, ActivityEvaluationPolicy } from "./activity-contract";

// ── RoutedHarnessPlan ───────────────────────────────────────────────────────

export interface RoutedHarnessPlan {
  recipeKey: string;
  activityClass: ActivityClass;
  activityConfidence: "provisional" | "calibrating" | "trusted" | "degraded";
  promptStrategy: string;
  contextAssembler: string;
  memoryPolicy: "none" | "thread-summary" | "work-case-packet" | "retrieval-packet";
  tokenPolicy: {
    inputPacking: "minimal" | "ranked-evidence" | "full-context" | "compressed";
    outputBudget: "tight" | "standard" | "expansive";
  };
  evaluator: ActivityEvaluationPolicy["evaluator"];
  providerFamily?: string;
  modelFamily?: string;
  executionAdapterHint?: string;
}

// ── RoutedExecutionPlan ──────────────────────────────────────────────────────

export interface RoutedExecutionPlan {
  providerId: string;
  modelId: string;
  recipeId: string | null;
  contractFamily: string;
  /**
   * Execution adapter selector. Accepts either a legacy string
   * ("claude-cli", "codex-cli", "chat", "responses", "embedding", …) OR a
   * structured `ExecutionAdapterSelector` object. Phase A6 added the
   * structured form; legacy strings continue to work via
   * `parseExecutionAdapterSelector` + `resolveExecutionAdapter`.
   */
  executionAdapter: string | ExecutionAdapterSelector;
  /**
   * Optional capability requirements (Phase A4/A6). When at least one entry
   * has `required: true`, the resolver gates dispatch on the adapter's
   * capability profile and throws `CapabilityRequirementUnsatisfiedError`
   * if unsatisfied. Advisory entries (`required: false`) are a no-op today
   * and become advisory-with-telemetry once A7 lands.
   */
  capabilityRequirements?: AdapterCapabilityRequirement[];
  maxTokens: number;
  temperature?: number;
  providerSettings: Record<string, unknown>;
  /** Typed, fail-closed OpenRouter wire policy. Present only for OpenRouter plans. */
  openRouterPolicy?: import("./provider-suitability/openrouter-policy").OpenRouterExecutionPolicy;
  /** Retained across fallback construction so OpenRouter cannot become an unbounded fallback. */
  openRouterObligations?: import("./provider-suitability/types").OpenRouterPolicyObligations;
  toolPolicy: {
    toolChoice?: "auto" | "required" | "none";
    allowParallelToolCalls?: boolean;
  };
  responsePolicy: {
    strictSchema?: boolean;
    stream?: boolean;
    /** Sole writer whose eventual execution is fail-closed by the caller's terminal-tool policy. */
    terminalWriterToolName?: string;
  };
  harness?: RoutedHarnessPlan;
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
