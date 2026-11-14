// apps/web/lib/routing/call-parameter-receipt.ts
//
// BI-B4081AA1: a compact, policy-safe record of HOW a model was called, so the
// audit log can answer it later.
//
// The execution plan already carried the resolved parameters, but nothing
// persisted them and nothing displayed them: `formatDecisionForUser` had no
// callers at all, and RouteDecisionLog stores candidate traces and receipts but
// not what was actually sent. So an operator could see why Qwen3 was chosen and
// never that it ran at temperature 1.0.
//
// This receipt is deliberately small and contains NO request content — only the
// numbers, where each came from, and whether the provider could carry the effort
// the contract asked for. It follows the same shape discipline as the
// suitability and data-screen receipts already on the row.
//
// Spec: docs/superpowers/specs/2026-09-18-situational-llm-call-parameterization-design.md §6

import type { RoutedExecutionPlan } from "./recipe-types";

export type CallParameterProvenance = "vendor" | "contract" | "recipe" | "operator";

export interface CallParameterReceipt {
  /** Resolved sampling values actually sent. */
  sampling: Partial<Record<"temperature" | "topP" | "topK" | "minP" | "repeatPenalty", number>>;
  /** Where each value came from. Same keys as `sampling`. */
  provenance: Partial<Record<"temperature" | "topP" | "topK" | "minP" | "repeatPenalty", CallParameterProvenance>>;
  /** Which vendor profile applied. */
  mode: "default" | "thinking";
  /** Parameters withheld because the model rejects them. */
  dropped?: string[];
  /** Output-token ceiling for the call. */
  maxTokens: number;
  /** How extended reasoning was expressed, if at all. */
  effort?: {
    /** The provider-side shape that carried it, for audit ("thinking", "reasoning_effort", …). */
    expressedAs: string;
    /** Thinking budget in tokens where the provider takes one. */
    budgetTokens?: number;
  };
  /** The contract asked for reasoning and this provider had no way to accept it. */
  effortUnexpressed?: boolean;
  /** Decoding was constrained to valid JSON. */
  constrainedDecoding?: boolean;
  /** The recipe that contributed learning, when one matched. */
  recipeId?: string;
}

/** Name the provider-side field that carried the effort, for the audit trail. */
function describeEffortShape(settings: Record<string, unknown>): CallParameterReceipt["effort"] | undefined {
  const thinking = settings.thinking as { type?: string; budget_tokens?: number } | undefined;
  if (thinking) {
    return {
      expressedAs: thinking.type === "adaptive" ? "thinking:adaptive" : "thinking:enabled",
      ...(typeof thinking.budget_tokens === "number" ? { budgetTokens: thinking.budget_tokens } : {}),
    };
  }
  const thinkingConfig = settings.thinkingConfig as { thinkingBudget?: number } | undefined;
  if (thinkingConfig) {
    return {
      expressedAs: "thinkingConfig.thinkingBudget",
      ...(typeof thinkingConfig.thinkingBudget === "number"
        ? { budgetTokens: thinkingConfig.thinkingBudget }
        : {}),
    };
  }
  const reasoning = settings.reasoning as { effort?: string } | undefined;
  if (reasoning?.effort) return { expressedAs: "reasoning.effort" };
  if (typeof settings.reasoning_effort === "string") return { expressedAs: "reasoning_effort" };
  if (settings.think === true) return { expressedAs: "think" };
  return undefined;
}

/**
 * Project a plan into its audit receipt, or undefined when there is no plan —
 * a preview route carries none, and an absent receipt must read as "not
 * recorded" rather than as "called with nothing".
 */
export function buildCallParameterReceipt(
  plan: RoutedExecutionPlan | undefined,
): CallParameterReceipt | undefined {
  if (!plan) return undefined;

  const sampling = plan.sampling?.values ?? {};
  // A plan predating the sampling record still carries a top-level temperature.
  const values = { ...sampling };
  if (values.temperature === undefined && plan.temperature !== undefined) {
    values.temperature = plan.temperature;
  }

  const effort = describeEffortShape(plan.providerSettings ?? {});

  return {
    sampling: values,
    provenance: plan.sampling?.provenance ?? {},
    mode: plan.sampling?.mode ?? "default",
    ...(plan.sampling?.dropped?.length ? { dropped: plan.sampling.dropped } : {}),
    maxTokens: plan.maxTokens,
    ...(effort ? { effort } : {}),
    ...(plan.effortUnexpressed ? { effortUnexpressed: true } : {}),
    ...(plan.responsePolicy?.strictSchema ? { constrainedDecoding: true } : {}),
    ...(plan.recipeId ? { recipeId: plan.recipeId } : {}),
  };
}

/** Plain-language reading of a temperature, for an operator who does not know the scale. */
export function describeVariability(temperature: number): string {
  if (temperature <= 0.05) return "no variation";
  if (temperature <= 0.3) return "little variation";
  if (temperature <= 0.75) return "some variation";
  return "deliberately varied";
}

/** Why a value is what it is, in words rather than a source enum. */
export function describeProvenance(
  origin: CallParameterProvenance,
  thinkingMode: boolean,
): string {
  switch (origin) {
    case "vendor":
      return thinkingMode
        ? "the model's published setting for reasoning mode"
        : "the model's published setting";
    case "contract":
      return "what this kind of task needs";
    case "recipe":
      return "what measured best for this model on this task";
    case "operator":
      return "an override set for this install";
  }
}
