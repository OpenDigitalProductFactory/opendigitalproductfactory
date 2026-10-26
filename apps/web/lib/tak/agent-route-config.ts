import { TIER_MINIMUM_DIMENSIONS, type QualityTier } from "../routing/quality-tiers";

export type AgentRouteConfig = {
  minimumDimensions?: Record<string, number>;
  budgetClass?: "minimize_cost" | "balanced" | "quality_first";
  preferredProviderId?: string;
  preferredModelId?: string;
  /** BI-7F2FBDA3: lineage of the pinned model, looked up even when it has retired. */
  preferredModelFamily?: string | null;
  allowedProviders?: string[];
  deniedProviders?: string[];
  residencyPolicy?: "local_only" | "approved_cloud" | "any_enabled";
  effort?: "low" | "medium" | "high" | "max";
};

export function resolveEffectiveAgentRouteConfig(params: {
  agentModelConfig: {
    minimumTier: string;
    budgetClass: string;
    pinnedProviderId: string | null;
    pinnedModelId: string | null;
  } | null;
  modelRequirements: unknown;
}): AgentRouteConfig {
  const codeConfig: AgentRouteConfig =
    params.modelRequirements && typeof params.modelRequirements === "object"
      ? {
          ...("defaultMinimumTier" in params.modelRequirements
            ? {
                minimumDimensions:
                  TIER_MINIMUM_DIMENSIONS[
                    params.modelRequirements.defaultMinimumTier as QualityTier
                  ] ?? {},
              }
            : "minimumDimensions" in params.modelRequirements
              ? {
                  minimumDimensions:
                    params.modelRequirements.minimumDimensions as Record<string, number>,
                }
              : {}),
          ...("defaultBudgetClass" in params.modelRequirements
            ? {
                budgetClass: params.modelRequirements.defaultBudgetClass as
                  | "minimize_cost"
                  | "balanced"
                  | "quality_first",
              }
            : "budgetClass" in params.modelRequirements
              ? {
                  budgetClass: params.modelRequirements.budgetClass as
                    | "minimize_cost"
                    | "balanced"
                    | "quality_first",
                }
              : {}),
          ...("preferredProviderId" in params.modelRequirements
            ? { preferredProviderId: params.modelRequirements.preferredProviderId as string }
            : {}),
          ...("preferredModelId" in params.modelRequirements
            ? { preferredModelId: params.modelRequirements.preferredModelId as string }
            : {}),
          ...("allowedProviders" in params.modelRequirements
            ? { allowedProviders: params.modelRequirements.allowedProviders as string[] }
            : {}),
          ...("deniedProviders" in params.modelRequirements
            ? { deniedProviders: params.modelRequirements.deniedProviders as string[] }
            : {}),
          ...("residencyPolicy" in params.modelRequirements
            ? {
                residencyPolicy: params.modelRequirements.residencyPolicy as
                  | "local_only"
                  | "approved_cloud"
                  | "any_enabled",
              }
            : {}),
          ...("defaultEffort" in params.modelRequirements
            ? {
                effort: params.modelRequirements.defaultEffort as
                  | "low"
                  | "medium"
                  | "high"
                  | "max",
              }
            : {}),
        }
      : {};

  if (!params.agentModelConfig) return codeConfig;

  return {
    ...codeConfig,
    minimumDimensions:
      TIER_MINIMUM_DIMENSIONS[params.agentModelConfig.minimumTier as QualityTier] ??
      codeConfig.minimumDimensions ??
      {},
    budgetClass: params.agentModelConfig.budgetClass as
      | "minimize_cost"
      | "balanced"
      | "quality_first",
    preferredProviderId:
      params.agentModelConfig.pinnedProviderId ?? codeConfig.preferredProviderId,
    preferredModelId:
      params.agentModelConfig.pinnedModelId ?? codeConfig.preferredModelId,
  };
}
