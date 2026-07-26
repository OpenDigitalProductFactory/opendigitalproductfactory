import { createHash } from "node:crypto";

import type { CapabilityInstallScope } from "@dpf/db/capability-maturity";

import type {
  WorkPatternMethodVariant,
  WorkPatternModelVariant,
} from "./work-pattern-experiment-types";

export type WorkPatternExperimentDefinitionIdentity = {
  patternKey: string;
  taskCorpusKey: string;
  taskCorpusVersion: string;
  oracleKey: string;
  oracleVersion: string;
  methodVariants: WorkPatternMethodVariant[];
  modelVariants: WorkPatternModelVariant[];
  installScope: CapabilityInstallScope;
  promotionPolicyKey: string;
  promotionPolicyVersion: number;
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function assertNonEmpty(value: string, error: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(error);
}

function assertPositiveInteger(value: number, error: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(error);
}

function assertNonNegativeInteger(value: number, error: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(error);
}

export function workPatternExperimentDefinitionKey(
  input: WorkPatternExperimentDefinitionIdentity,
): string {
  const canonical = {
    patternKey: input.patternKey,
    taskCorpusKey: input.taskCorpusKey,
    taskCorpusVersion: input.taskCorpusVersion,
    oracleKey: input.oracleKey,
    oracleVersion: input.oracleVersion,
    methodVariants: [...input.methodVariants].sort((left, right) =>
      left.methodVariantKey.localeCompare(right.methodVariantKey)),
    modelVariants: [...input.modelVariants].sort((left, right) =>
      left.modelVariantKey.localeCompare(right.modelVariantKey)),
    installScope: input.installScope,
    promotionPolicyKey: input.promotionPolicyKey,
    promotionPolicyVersion: input.promotionPolicyVersion,
  };
  return `WPD-${digest(canonical).toUpperCase()}`;
}

export function workPatternExperimentRunId(
  experimentDefinitionKey: string,
  replicate: number,
): string {
  assertNonEmpty(experimentDefinitionKey, "invalid_experiment_definition_key");
  assertPositiveInteger(replicate, "invalid_replicate");
  return `WPR-${digest({ experimentDefinitionKey, replicate }).toUpperCase()}`;
}

export function workPatternExperimentParentTaskRunId(experimentRunId: string): string {
  assertNonEmpty(experimentRunId, "invalid_experiment_run_id");
  return `TR-WPX-${digest({ experimentRunId }).toUpperCase()}`;
}

export function workPatternCellKey(input: {
  methodVariantKey: string;
  modelVariantKey: string;
}): string {
  assertNonEmpty(input.methodVariantKey, "invalid_method_variant_key");
  assertNonEmpty(input.modelVariantKey, "invalid_model_variant_key");
  return `${input.methodVariantKey}:${input.modelVariantKey}`;
}

export function workPatternExperimentChildTaskRunId(input: {
  experimentRunId: string;
  cellKey: string;
  pairKey: string;
  attempt: number;
}): string {
  assertNonEmpty(input.experimentRunId, "invalid_experiment_run_id");
  assertNonEmpty(input.cellKey, "invalid_cell_key");
  assertNonEmpty(input.pairKey, "invalid_pair_key");
  assertPositiveInteger(input.attempt, "invalid_attempt");
  return `TR-WPC-${digest(input).toUpperCase()}`;
}

export function workPatternExperimentLedgerId(input: {
  experimentRunId: string;
  childTaskRunId: string;
  observationKind: string;
  sequence: number;
}): string {
  assertNonEmpty(input.experimentRunId, "invalid_experiment_run_id");
  assertNonEmpty(input.childTaskRunId, "invalid_child_task_run_id");
  assertNonEmpty(input.observationKind, "invalid_observation_kind");
  assertNonNegativeInteger(input.sequence, "invalid_sequence");
  return `DSL-WPX-${digest(input).toUpperCase()}`;
}
