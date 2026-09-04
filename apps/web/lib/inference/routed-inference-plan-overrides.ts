import type { RoutedExecutionPlan } from "@/lib/routing/recipe-types";

type CallerExecutionPlanOverrides = {
  effort?: "low" | "medium" | "high" | "max";
  toolChoice?: "auto" | "required" | "none";
  terminalWriterToolName?: string;
};

/** Apply caller-owned dispatch constraints after recipe and harness resolution. */
export function applyCallerExecutionPlanOverrides(
  plan: RoutedExecutionPlan,
  overrides: CallerExecutionPlanOverrides,
): RoutedExecutionPlan {
  return {
    ...plan,
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
