// apps/web/lib/deliberation/request-contract.ts
// Task 6 — Per-role RequestContract builder for deliberation branches.
//
// Every deliberation branch is dispatched through the existing routing
// pipeline (pipeline-v2 / task-router) — there is no parallel routing path
// (spec §9.7). The only thing this module does is translate a pattern role
// + strategy profile into a RequestContract the router already knows how to
// consume.
//
// Diversity is expressed as a PREFERENCE (spec §9), never a hard pin. Per
// project memory "no provider pinning", we do not set allowedProviders or
// any provider/model hard selection. Instead, callers read the preferences
// off the contract and drive dispatch variation (e.g. exclude the provider
// already selected on branch A when routing branch B).
//
// Input: a ResolvedDeliberationPattern role, the strategy profile resolved
// by activation.ts, and optional per-role routing recipe hints from
// registry.extractRoleRecipes().
// Output: a RequestContract ready to be passed to routeEndpointV2().

import { randomUUID } from "node:crypto";
import type { RequestContract } from "@/lib/routing/request-contract";
import type { AgentMinimumCapabilities } from "@/lib/routing/agent-capability-types";
import type {
  DeliberationDiversityMode,
  DeliberationStrategyProfile,
} from "./types";
import type { RoleRoutingRecipeHint } from "./registry";

/* -------------------------------------------------------------------------- */
/* Public shapes                                                              */
/* -------------------------------------------------------------------------- */

export type DeliberationRoleId =
  | "author"
  | "reviewer"
  | "skeptic"
  | "debater"
  | "adjudicator";

export interface BuildBranchRequestContractInput {
  roleId: string;
  strategyProfile: DeliberationStrategyProfile;
  diversityMode: DeliberationDiversityMode;
  artifactType: string;
  sensitivity?: RequestContract["sensitivity"];
  recipeHint?: RoleRoutingRecipeHint;
  /** Provider ids that earlier branches already got assigned. Used for
   *  heterogeneous-provider preference — callers pass these in so the
   *  returned contract carries an `allowedProviders` EXCLUSION hint via
   *  `preferredProviderExclusions` metadata we stash on the contract as a
   *  soft signal. NOT a hard pin. */
  priorProviderIds?: string[];
  /** Prior model ids already assigned — used for multi-model-same-provider
   *  diversity as a soft preference. */
  priorModelIds?: string[];
}

export interface BranchRequestContract extends RequestContract {
  /** Deliberation-only preferences carried as metadata on the contract so
   *  downstream dispatch can honor them without changing the core
   *  RequestContract schema. Routing pipeline ignores unknown keys. */
  deliberationPreferences: {
    roleId: string;
    preferProviderDiversity: boolean;
    requireProviderDiversity: boolean;
    priorProviderIds: string[];
    priorModelIds: string[];
    diversityMode: DeliberationDiversityMode;
    strategyProfile: DeliberationStrategyProfile;
  };
}

/* -------------------------------------------------------------------------- */
/* Per-role defaults                                                          */
/* -------------------------------------------------------------------------- */

const ROLE_TASK_TYPE: Record<string, string> = {
  author: "code_gen",
  // reviewer feeds structured review; the routing "review" task type is
  // already in task-requirements. Kept here for readability.
  reviewer: "review",
  skeptic: "review",
  debater: "argumentation",
  adjudicator: "synthesis",
};

const ROLE_DEFAULT_CAPABILITIES: Record<string, AgentMinimumCapabilities> = {
  // Deliberation branches default read-only — spec §6.5 point 3.
  // toolUse is NOT a floor, because read-only retrieval can be handled
  // without tool-use endpoints. Patterns that need tools must declare it
  // at the pattern level (out of scope here; contract stays conservative).
  author: {},
  reviewer: {},
  skeptic: {},
  debater: {},
  adjudicator: {},
};

const STRATEGY_REASONING_DEPTH: Record<
  DeliberationStrategyProfile,
  RequestContract["reasoningDepth"]
> = {
  economy: "low",
  balanced: "medium",
  "high-assurance": "high",
  "document-authority": "medium",
};

const STRATEGY_BUDGET_CLASS: Record<
  DeliberationStrategyProfile,
  RequestContract["budgetClass"]
> = {
  economy: "minimize_cost",
  balanced: "balanced",
  "high-assurance": "quality_first",
  "document-authority": "balanced",
};

const CAPABILITY_TIER_TO_REASONING: Record<
  "low" | "medium" | "high",
  RequestContract["reasoningDepth"]
> = {
  low: "low",
  medium: "medium",
  high: "high",
};

/* -------------------------------------------------------------------------- */
/* Builder                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build a RequestContract for one deliberation branch role.
 *
 * The result is intentionally MINIMAL — downstream routing fills in the
 * rest. We set:
 *   - taskType (role-specific; default mapping above)
 *   - reasoningDepth / budgetClass (from strategyProfile, recipe hint wins)
 *   - minimumCapabilities (role-specific, defaults to {} = no floor)
 *   - interactionMode (always "background" for deliberation branches so the
 *     router treats them as non-interactive and avoids streaming-only gates)
 *   - sensitivity (from input or "internal" default)
 *   - deliberationPreferences metadata for diversity hinting
 */
export function buildBranchRequestContract(
  input: BuildBranchRequestContractInput,
): BranchRequestContract {
  const {
    roleId,
    strategyProfile,
    diversityMode,
    artifactType,
    sensitivity = "internal",
    recipeHint,
    priorProviderIds = [],
    priorModelIds = [],
  } = input;

  // Resolve taskType: recipe hint wins, otherwise role default, otherwise
  // fall back to "review" (safe general-purpose).
  const taskType =
    recipeHint?.taskType ??
    ROLE_TASK_TYPE[roleId] ??
    "review";

  // reasoningDepth: capability tier from recipe hint wins, otherwise derive
  // from strategyProfile.
  const reasoningDepth: RequestContract["reasoningDepth"] = recipeHint?.capabilityTier
    ? CAPABILITY_TIER_TO_REASONING[recipeHint.capabilityTier]
    : STRATEGY_REASONING_DEPTH[strategyProfile];

  const budgetClass = STRATEGY_BUDGET_CLASS[strategyProfile];

  const minimumCapabilities: AgentMinimumCapabilities =
    ROLE_DEFAULT_CAPABILITIES[roleId] ?? {};

  const preferProviderDiversity =
    recipeHint?.preferProviderDiversity ??
    (diversityMode === "multi-provider-heterogeneous" ||
      diversityMode === "multi-model-same-provider");

  const requireProviderDiversity =
    recipeHint?.requireProviderDiversity ?? false;

  const contract: BranchRequestContract = {
    contractId: randomUUID(),
    contractFamily: `deliberation.${roleId}.${artifactType}`,
    taskType,

    modality: {
      input: ["text"],
      output: ["text"],
    },

    interactionMode: "background",
    sensitivity,

    requiresTools: false,
    requiresStrictSchema: false,
    requiresStreaming: false,

    estimatedInputTokens: 2_000,
    estimatedOutputTokens: 1_200,

    reasoningDepth,
    budgetClass,

    minimumCapabilities,

    deliberationPreferences: {
      roleId,
      preferProviderDiversity,
      requireProviderDiversity,
      priorProviderIds,
      priorModelIds,
      diversityMode,
      strategyProfile,
    },
  };

  return contract;
}
