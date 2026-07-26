import { isRecord } from "@/lib/shared/coerce";
import { parseWorkPatternExecutionProfile } from "@/lib/tak/work-pattern-experiment-types";

import type { WorkPatternExperimentCellRequest } from "./work-pattern-experiment-adapter";

export function parsePersistedWorkPatternExperimentExecution(
  value: unknown,
): WorkPatternExperimentCellRequest | null {
  if (!isRecord(value)) return null;
  const executionProfile = parseWorkPatternExecutionProfile(value.executionProfile);
  const requiredStrings = [
    "experimentRunId",
    "childTaskRunId",
    "cellKey",
    "pairKey",
    "methodVariantKey",
    "modelVariantKey",
    "fixtureKey",
    "oracleKey",
    "oracleVersion",
    "resourcePolicyKey",
  ] as const;
  if (
    !executionProfile
    || requiredStrings.some(
      (field) => typeof value[field] !== "string" || value[field].trim().length === 0,
    )
  ) {
    return null;
  }
  return {
    experimentRunId: value.experimentRunId as string,
    childTaskRunId: value.childTaskRunId as string,
    cellKey: value.cellKey as string,
    pairKey: value.pairKey as string,
    methodVariantKey: value.methodVariantKey as string,
    modelVariantKey: value.modelVariantKey as string,
    executionProfile,
    fixtureKey: value.fixtureKey as string,
    oracleKey: value.oracleKey as string,
    oracleVersion: value.oracleVersion as string,
    resourcePolicyKey: value.resourcePolicyKey as string,
  };
}

/**
 * Runtime boundary for persisted queue requests. The durable queue can safely
 * resume and validate work now; the concrete sandbox executor is installed by
 * the Build Studio integration seam, never serialized into TaskRun metadata.
 */
export async function executePersistedWorkPatternExperimentCell(
  taskRunId: string,
  value: unknown,
): Promise<never> {
  const request = parsePersistedWorkPatternExperimentExecution(value);
  if (!request || request.childTaskRunId !== taskRunId) {
    throw new Error(`invalid_work_pattern_experiment_execution_request:${taskRunId}`);
  }
  throw new Error(
    `work_pattern_experiment_executor_unavailable:${request.executionProfile.environmentKey}`,
  );
}
