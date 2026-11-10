import type { RoutedExecutionPlan } from "@/lib/routing/recipe-types";

type CallerExecutionPlanOverrides = {
  maxOutputTokens?: number;
  effort?: "low" | "medium" | "high" | "max";
  toolChoice?: "auto" | "required" | "none";
  terminalWriterToolName?: string;
};

/** Apply caller-owned dispatch constraints after recipe and harness resolution. */
export function applyCallerExecutionPlanOverrides(
  plan: RoutedExecutionPlan,
  overrides: CallerExecutionPlanOverrides,
): RoutedExecutionPlan {
  const ceiling = overrides.maxOutputTokens;
  if (ceiling !== undefined && (!Number.isSafeInteger(ceiling) || ceiling <= 0)) {
    throw new RangeError("Invalid caller output budget");
  }
  return {
    ...plan,
    ...(ceiling !== undefined ? { maxTokens: Math.min(plan.maxTokens, ceiling) } : {}),
    ...(overrides.effort
      ? { providerSettings: { ...plan.providerSettings, effort: overrides.effort } }
      : {}),
    ...(overrides.toolChoice
      ? { toolPolicy: { ...plan.toolPolicy, toolChoice: overrides.toolChoice } }
      : {}),
    ...(overrides.terminalWriterToolName
      ? { responsePolicy: { ...plan.responsePolicy, terminalWriterToolName: overrides.terminalWriterToolName } }
      : {}),
  };
}
