import type { RouteSensitivity } from "@/lib/agent-sensitivity";
import type { DispatchPosture } from "@/lib/golden-triangle/dispatch";
import type { RouteAndCallOptions } from "@/lib/inference/routed-inference-options";
import {
  inferContract,
  type RequestContract,
  type RequestRouteContext,
} from "@/lib/routing/request-contract";
import type { TaskRequirement } from "@/lib/routing/task-router-types";

export function buildInitialRouteContext(input: {
  sensitivity: RouteSensitivity;
  options?: RouteAndCallOptions;
  posture: DispatchPosture | null;
  localOnlyInference: boolean;
}): RequestRouteContext {
  const { options, posture } = input;
  return {
    ...(posture?.routeContext ?? {}),
    sensitivity: input.sensitivity,
    interactionMode: options?.interactionMode,
    requiresCodeExecution: options?.requiresCodeExecution,
    requiresWebSearch: options?.requiresWebSearch,
    requiresComputerUse: options?.requiresComputerUse,
    budgetClass: posture?.routeContext.budgetClass ?? options?.budgetClass,
    allowedProviders: options?.allowedProviders,
    deniedProviders: options?.deniedProviders,
    residencyPolicy:
      options?.modelTier === "local" || input.localOnlyInference
        ? "local_only"
        : options?.residencyPolicy,
    requiredModelClass: options?.requiredModelClass,
  };
}

export async function buildEffectiveRequestContract(input: {
  taskType: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: Array<Record<string, unknown>>;
  routeContext: RequestRouteContext;
  options?: RouteAndCallOptions;
  taskRequirement?: TaskRequirement | null;
}): Promise<RequestContract> {
  const contract =
    input.taskRequirement === undefined
      ? await inferContract(
          input.taskType,
          input.messages,
          input.tools,
          undefined,
          input.routeContext,
        )
      : await inferContract(
          input.taskType,
          input.messages,
          input.tools,
          undefined,
          input.routeContext,
          input.taskRequirement,
        );

  contract.minimumDimensions = mergeMinimumDimensions(
    contract.minimumDimensions,
    input.options?.minimumDimensions,
  );
  if (input.options?.minimumCapabilities !== undefined) {
    contract.minimumCapabilities = input.options.minimumCapabilities;
  }
  if (input.options?.agentMinimumContextTokens !== undefined) {
    contract.minContextTokens = Math.max(
      contract.minContextTokens ?? 0,
      input.options.agentMinimumContextTokens,
    );
  }
  return contract;
}

export function mergeMinimumDimensions(
  base: Record<string, number> | undefined,
  floor: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!base && !floor) return undefined;
  const merged = { ...(base ?? {}) };
  for (const [dimension, score] of Object.entries(floor ?? {})) {
    merged[dimension] = Math.max(merged[dimension] ?? 0, score);
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}
