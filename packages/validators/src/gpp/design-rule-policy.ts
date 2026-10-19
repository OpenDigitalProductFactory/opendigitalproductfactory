import type { LoweredWorkShapeDefinition } from "./emit.js";

/** Read-only host policy facts. These ports never grant permission or execute a tool. */
export type GppDesignRulePolicy = {
  /** Informational host declaration, never proof of runtime mediation. */
  singleTransitionPath?: string;
  baselineGrants: readonly string[];
  knownStageToolGap(shapeKey: string, stageKey: string): boolean;
  isToolAllowedByGrants(toolName: string, grants: readonly string[]): boolean;
  roomGrantsFromWorkShape(grants: readonly string[]): readonly string[];
  bindingEnforced(bindingId: string): boolean;
  governedDecisionStage(definition: LoweredWorkShapeDefinition, stageKey: string): boolean;
};

export function hasDesignRulePolicy(value: unknown): value is GppDesignRulePolicy {
  if (typeof value !== "object" || value === null) return false;
  const policy = value as Record<string, unknown>;
  return (policy.singleTransitionPath === undefined || (typeof policy.singleTransitionPath === "string" && policy.singleTransitionPath.trim().length > 0))
    && Array.isArray(policy.baselineGrants) && policy.baselineGrants.every(grant => typeof grant === "string")
    && ["knownStageToolGap", "isToolAllowedByGrants", "roomGrantsFromWorkShape", "bindingEnforced", "governedDecisionStage"]
      .every(name => typeof policy[name] === "function");
}
