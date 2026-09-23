/**
 * EP-INF-005b: Execution plan builder for the contract-based routing pipeline.
 *
 * Produces a RoutedExecutionPlan either from a matched ModelRecipe row
 * (buildPlanFromRecipe) or as a safe fallback default (buildDefaultPlan).
 *
 * See: docs/superpowers/specs/2026-03-20-contract-based-selection-design.md
 */

import { terminalWriterDispatchContract, type TerminalWriterDispatchContract } from "./execution-adapter-types";
import type { RequestContract } from "./request-contract";
import type { EndpointManifest } from "./types";
import type { RecipeRow, RoutedExecutionPlan } from "./recipe-types";
import { resolveSamplingProfile, type ResolvedSampling } from "./sampling-profile";
import { effectiveSampling } from "./vendor-sampling-catalog";
import { expressEffort, resolveEffort, type ReasoningDepth } from "./effort-expression";
import type { HarnessRecipe } from "./harness-recipe";
import { usesResponsesApi, usesCliAdapter, usesCodexCli } from "./provider-utils";
import {
  compileOpenRouterExecutionPolicy,
  type OpenRouterProviderSettings,
} from "./provider-suitability/openrouter-policy";

// EP-INF-009c: Model class → execution adapter mapping
const MODEL_CLASS_ADAPTER: Record<string, string> = {
  chat: "chat",
  reasoning: "chat",
  image_gen: "image_gen",
  embedding: "embedding",
  audio: "transcription",
  code: "chat",
};

export function resolveProviderExecutionAdapter(providerId: string): string | null {
  if (usesCodexCli(providerId)) return "codex-cli";
  if (usesResponsesApi(providerId)) return "responses";
  if (usesCliAdapter(providerId)) return "claude-cli";
  return null;
}

export function resolveDefaultExecutionAdapter(
  providerId: string,
  requiredModelClass?: string,
): string {
  const providerAdapter = resolveProviderExecutionAdapter(providerId);
  if (providerAdapter) return providerAdapter;
  if (requiredModelClass) return MODEL_CLASS_ADAPTER[requiredModelClass] ?? "chat";
  return "chat";
}

/**
 * The terminal-writer dispatch contract the provider that actually ran was held
 * to (BI-C35576A9). Undefined when no provider ran ("unknown" / empty), so a
 * TaskRun record never claims a contract for a dispatch that did not happen.
 */
export function terminalWriterDispatchContractForProvider(
  providerId: string | null | undefined,
): TerminalWriterDispatchContract | undefined {
  const id = providerId?.trim();
  if (!id || id === "unknown") return undefined;
  return terminalWriterDispatchContract(resolveDefaultExecutionAdapter(id));
}

// ── Situational parameters (BI-1F5DAABC / BI-40DA6D05 / BI-DBAFEC10) ────────

/**
 * What the endpoint tells us about the model, for parameter resolution. A subset
 * of EndpointManifest so the plan builders can be called with a light object in
 * tests and with the real manifest in the pipeline.
 */
export type ParameterizationContext = Pick<
  EndpointManifest,
  "providerId" | "modelId" | "modelFamily" | "modelClass" | "maxOutputTokens" | "capabilities"
> & { sampling?: import("./model-card-types").ModelCardSampling | null };

/**
 * Resolve effort and sampling for one call, and fold them into the plan.
 *
 * This runs on BOTH plan-building paths. Before this, the only parameter logic
 * lived in the champion-recipe maintenance job, so any dispatch that did not
 * match a recipe row went out with `providerSettings: {}` — provider defaults.
 */
function applySituationalParameters(
  plan: RoutedExecutionPlan,
  contract: RequestContract,
  ctx: ParameterizationContext | undefined,
  recipeSettings: Record<string, unknown> | null,
): RoutedExecutionPlan {
  if (!ctx) return plan;

  const effort = resolveEffort({
    reasoningDepth: contract.reasoningDepth as ReasoningDepth,
    estimatedInputTokens: contract.estimatedInputTokens,
    maxOutputTokens: ctx.maxOutputTokens,
    capabilities: ctx.capabilities,
  });

  const expression = expressEffort(ctx.providerId, effort, ctx.capabilities, {
    modelClass: ctx.modelClass,
    isLocalNative: isLocalNativeProvider(ctx.providerId),
  });

  const sampling: ResolvedSampling = resolveSamplingProfile({
    sampling: effectiveSampling(ctx),
    contractFamily: contract.contractFamily,
    thinking: expression.thinking,
    strictSchema: contract.requiresStrictSchema,
    recipeSettings,
  });

  const next: RoutedExecutionPlan = {
    ...plan,
    providerSettings: { ...plan.providerSettings, ...expression.settings },
    maxTokens: plan.maxTokens + expression.extraMaxTokens,
    sampling: {
      values: sampling.values,
      provenance: sampling.provenance,
      mode: sampling.mode,
      ...(sampling.dropped.length > 0 ? { dropped: sampling.dropped } : {}),
    },
    ...(expression.effortUnexpressed ? { effortUnexpressed: true } : {}),
  };

  // `temperature` stays the canonical top-level field the adapters already read;
  // the sampling record carries the rest plus provenance for the explanation.
  if (sampling.values.temperature !== undefined) {
    next.temperature = sampling.values.temperature;
  } else if (sampling.dropped.includes("temperature")) {
    delete next.temperature;
  }

  return next;
}

function isLocalNativeProvider(providerId: string): boolean {
  const id = providerId.toLowerCase();
  return id === "local" || id === "ollama";
}

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
  ctx?: ParameterizationContext,
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
  const executionAdapter =
    resolveProviderExecutionAdapter(recipe.providerId) ??
    recipe.executionAdapter ??
    "chat";

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
    ...(contract.openRouterObligations
      ? { openRouterObligations: contract.openRouterObligations }
      : {}),
  };

  if (typeof temperature === "number") {
    plan.temperature = temperature;
  }

  if (recipe.providerId === "openrouter" && contract.openRouterObligations) {
    plan.openRouterPolicy = compileOpenRouterExecutionPolicy(
      contract.openRouterObligations,
      (remainingSettings.openRouterProviderSettings ?? {}) as OpenRouterProviderSettings,
    );
  }

  // The recipe's own temperature is the champion/challenger learning layer; the
  // resolver treats it as such and may still be narrowed by an operator override
  // or dropped when the model rejects it.
  return applySituationalParameters(plan, contract, ctx, settings as Record<string, unknown>);
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
  // "Default" now means "vendor and contract parameters, without recipe
  // learning" — not "no parameters". That distinction is the whole of BI-1F5DAABC.
  const toolPolicy: RoutedExecutionPlan["toolPolicy"] = {};
  if (contract.requiresTools) {
    toolPolicy.toolChoice = "auto";
  }

  const responsePolicy: RoutedExecutionPlan["responsePolicy"] = {
    strictSchema: contract.requiresStrictSchema,
    stream: contract.requiresStreaming,
  };

  // EP-INF-009c: Select adapter based on required model class
  const adapterType = resolveDefaultExecutionAdapter(
    endpoint.providerId,
    contract.requiredModelClass,
  );

  const plan: RoutedExecutionPlan = {
    providerId: endpoint.providerId,
    modelId: endpoint.modelId,
    recipeId: null,
    contractFamily: contract.contractFamily,
    executionAdapter: adapterType,
    maxTokens: 4096,
    providerSettings: {},
    toolPolicy,
    responsePolicy,
    ...(contract.openRouterObligations
      ? { openRouterObligations: contract.openRouterObligations }
      : {}),
  };
  if (endpoint.providerId === "openrouter" && contract.openRouterObligations) {
    plan.openRouterPolicy = compileOpenRouterExecutionPolicy(contract.openRouterObligations);
  }
  return applySituationalParameters(plan, contract, endpoint, null);
}

// ── attachHarnessRecipeToPlan ───────────────────────────────────────────────

export function attachHarnessRecipeToPlan(
  plan: RoutedExecutionPlan,
  harnessRecipe: HarnessRecipe,
): RoutedExecutionPlan {
  return {
    ...plan,
    harness: {
      recipeKey: harnessRecipe.recipeKey,
      activityClass: harnessRecipe.activityClass,
      activityConfidence: harnessRecipe.activityConfidence,
      promptStrategy: harnessRecipe.promptStrategy,
      contextAssembler: harnessRecipe.contextAssembler,
      memoryPolicy: harnessRecipe.memoryPolicy,
      tokenPolicy: harnessRecipe.tokenPolicy,
      evaluator: harnessRecipe.evaluator,
      providerFamily: harnessRecipe.providerFamily,
      modelFamily: harnessRecipe.modelFamily,
      executionAdapterHint: harnessRecipe.executionAdapterHint,
    },
  };
}
