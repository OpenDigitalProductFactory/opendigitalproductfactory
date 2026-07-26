import {
  CAPABILITY_INSTALL_SCOPES,
  type CapabilityInstallScope,
} from "@dpf/db/capability-maturity";

import type { RiskClass } from "@/lib/autonomy/trust-graduation";
import { isRecord } from "@/lib/shared/coerce";

export const WORK_PATTERN_EXPERIMENT_RISK_CLASSES = [
  "read-only",
  "internal-reversible",
  "internal-irreversible",
  "outbound-or-floor",
] as const satisfies readonly RiskClass[];

export const WORK_PATTERN_EXPERIMENT_LIFECYCLES = [
  "planned",
  "running",
  "analyzing",
  "completed",
  "cancelled",
] as const;

export type WorkPatternExperimentLifecycle =
  (typeof WORK_PATTERN_EXPERIMENT_LIFECYCLES)[number];

export type WorkPatternExecutionProfile = {
  patternKey: string;
  patternVersion: number;
  variantKey: string;
  activityKey: string;
  riskClass: RiskClass;
  providerId: string;
  modelId: string;
  modelProfileId?: string;
  toolPackDigest: string;
  promptOrSkillDigest: string;
  contextPolicyKey: string;
  recoveryPolicyKey: string;
  installScope: CapabilityInstallScope;
  organizationId?: string;
  taskCorpusKey: string;
  taskCorpusVersion: string;
  environmentKey: string;
  sourceCommitSha: string;
};

export type WorkPatternMethodVariant = {
  methodVariantKey: string;
  patternVersion: number;
};

export type WorkPatternModelVariant = {
  modelVariantKey: string;
  modelProfileId: string;
};

export type WorkPatternExperimentMetadataV1 = {
  schemaVersion: 1;
  experimentDefinitionKey: string;
  experimentRunId: string;
  replicate: number;
  patternKey: string;
  activityKey: string;
  riskClass: RiskClass;
  methodVariants: WorkPatternMethodVariant[];
  modelVariants: WorkPatternModelVariant[];
  requiredCellKeys: string[];
  taskCorpusKey: string;
  taskCorpusVersion: string;
  oracleKey: string;
  oracleVersion: string;
  promotionPolicyKey: string;
  promotionPolicyVersion: number;
  installScope: CapabilityInstallScope;
  lifecycle: WorkPatternExperimentLifecycle;
};

const PROFILE_KEYS = new Set<keyof WorkPatternExecutionProfile>([
  "patternKey",
  "patternVersion",
  "variantKey",
  "activityKey",
  "riskClass",
  "providerId",
  "modelId",
  "modelProfileId",
  "toolPackDigest",
  "promptOrSkillDigest",
  "contextPolicyKey",
  "recoveryPolicyKey",
  "installScope",
  "organizationId",
  "taskCorpusKey",
  "taskCorpusVersion",
  "environmentKey",
  "sourceCommitSha",
]);

const MANIFEST_KEYS = new Set<keyof WorkPatternExperimentMetadataV1>([
  "schemaVersion",
  "experimentDefinitionKey",
  "experimentRunId",
  "replicate",
  "patternKey",
  "activityKey",
  "riskClass",
  "methodVariants",
  "modelVariants",
  "requiredCellKeys",
  "taskCorpusKey",
  "taskCorpusVersion",
  "oracleKey",
  "oracleVersion",
  "promotionPolicyKey",
  "promotionPolicyVersion",
  "installScope",
  "lifecycle",
]);

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function includesValue<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return isNonEmptyString(value) ? value : null;
}

function parseMethodVariants(value: unknown): WorkPatternMethodVariant[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed: WorkPatternMethodVariant[] = [];
  const identities = new Set<string>();
  for (const row of value) {
    if (
      !isRecord(row)
      || !hasOnlyKeys(row, new Set(["methodVariantKey", "patternVersion"]))
      || !isNonEmptyString(row.methodVariantKey)
      || !isPositiveInteger(row.patternVersion)
      || identities.has(row.methodVariantKey)
    ) {
      return null;
    }
    identities.add(row.methodVariantKey);
    parsed.push({
      methodVariantKey: row.methodVariantKey,
      patternVersion: row.patternVersion,
    });
  }
  return parsed;
}

function parseModelVariants(value: unknown): WorkPatternModelVariant[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed: WorkPatternModelVariant[] = [];
  const identities = new Set<string>();
  for (const row of value) {
    if (
      !isRecord(row)
      || !hasOnlyKeys(row, new Set(["modelVariantKey", "modelProfileId"]))
      || !isNonEmptyString(row.modelVariantKey)
      || !isNonEmptyString(row.modelProfileId)
      || identities.has(row.modelVariantKey)
    ) {
      return null;
    }
    identities.add(row.modelVariantKey);
    parsed.push({
      modelVariantKey: row.modelVariantKey,
      modelProfileId: row.modelProfileId,
    });
  }
  return parsed;
}

function parseUniqueStrings(value: unknown): string[] | null {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some((entry) => !isNonEmptyString(entry))
  ) {
    return null;
  }
  const values = value as string[];
  return new Set(values).size === values.length ? values : null;
}

export function parseWorkPatternExecutionProfile(
  value: unknown,
): WorkPatternExecutionProfile | null {
  if (!isRecord(value) || !hasOnlyKeys(value, PROFILE_KEYS)) return null;

  const requiredStrings = [
    "patternKey",
    "variantKey",
    "activityKey",
    "providerId",
    "modelId",
    "toolPackDigest",
    "promptOrSkillDigest",
    "contextPolicyKey",
    "recoveryPolicyKey",
    "taskCorpusKey",
    "taskCorpusVersion",
    "environmentKey",
    "sourceCommitSha",
  ] as const;
  if (requiredStrings.some((field) => !isNonEmptyString(value[field]))) return null;
  if (!isPositiveInteger(value.patternVersion)) return null;
  if (!includesValue(WORK_PATTERN_EXPERIMENT_RISK_CLASSES, value.riskClass)) return null;
  if (!includesValue(CAPABILITY_INSTALL_SCOPES, value.installScope)) return null;

  const modelProfileId = optionalString(value.modelProfileId);
  const organizationId = optionalString(value.organizationId);
  if (modelProfileId === null || organizationId === null) return null;

  return {
    patternKey: value.patternKey as string,
    patternVersion: value.patternVersion,
    variantKey: value.variantKey as string,
    activityKey: value.activityKey as string,
    riskClass: value.riskClass,
    providerId: value.providerId as string,
    modelId: value.modelId as string,
    ...(modelProfileId ? { modelProfileId } : {}),
    toolPackDigest: value.toolPackDigest as string,
    promptOrSkillDigest: value.promptOrSkillDigest as string,
    contextPolicyKey: value.contextPolicyKey as string,
    recoveryPolicyKey: value.recoveryPolicyKey as string,
    installScope: value.installScope,
    ...(organizationId ? { organizationId } : {}),
    taskCorpusKey: value.taskCorpusKey as string,
    taskCorpusVersion: value.taskCorpusVersion as string,
    environmentKey: value.environmentKey as string,
    sourceCommitSha: value.sourceCommitSha as string,
  };
}

export function parseWorkPatternExperimentMetadata(
  value: unknown,
): WorkPatternExperimentMetadataV1 | null {
  if (!isRecord(value) || !hasOnlyKeys(value, MANIFEST_KEYS)) return null;
  if (value.schemaVersion !== 1) return null;
  if (!isPositiveInteger(value.replicate) || !isPositiveInteger(value.promotionPolicyVersion)) {
    return null;
  }
  if (!includesValue(WORK_PATTERN_EXPERIMENT_RISK_CLASSES, value.riskClass)) return null;
  if (!includesValue(CAPABILITY_INSTALL_SCOPES, value.installScope)) return null;
  if (!includesValue(WORK_PATTERN_EXPERIMENT_LIFECYCLES, value.lifecycle)) return null;

  const requiredStrings = [
    "experimentDefinitionKey",
    "experimentRunId",
    "patternKey",
    "activityKey",
    "taskCorpusKey",
    "taskCorpusVersion",
    "oracleKey",
    "oracleVersion",
    "promotionPolicyKey",
  ] as const;
  if (requiredStrings.some((field) => !isNonEmptyString(value[field]))) return null;

  const methodVariants = parseMethodVariants(value.methodVariants);
  const modelVariants = parseModelVariants(value.modelVariants);
  const requiredCellKeys = parseUniqueStrings(value.requiredCellKeys);
  if (!methodVariants || !modelVariants || !requiredCellKeys) return null;

  return {
    schemaVersion: 1,
    experimentDefinitionKey: value.experimentDefinitionKey as string,
    experimentRunId: value.experimentRunId as string,
    replicate: value.replicate,
    patternKey: value.patternKey as string,
    activityKey: value.activityKey as string,
    riskClass: value.riskClass,
    methodVariants,
    modelVariants,
    requiredCellKeys,
    taskCorpusKey: value.taskCorpusKey as string,
    taskCorpusVersion: value.taskCorpusVersion as string,
    oracleKey: value.oracleKey as string,
    oracleVersion: value.oracleVersion as string,
    promotionPolicyKey: value.promotionPolicyKey as string,
    promotionPolicyVersion: value.promotionPolicyVersion,
    installScope: value.installScope,
    lifecycle: value.lifecycle,
  };
}

export function experimentLifecycleToTaskStatus(
  lifecycle: WorkPatternExperimentLifecycle,
): "submitted" | "working" | "completed" | "canceled" {
  if (lifecycle === "planned") return "submitted";
  if (lifecycle === "running" || lifecycle === "analyzing") return "working";
  return lifecycle === "completed" ? "completed" : "canceled";
}

export function canTransitionWorkPatternExperiment(
  from: WorkPatternExperimentLifecycle,
  to: WorkPatternExperimentLifecycle,
): boolean {
  if (from === to) return true;
  if (from === "completed" || from === "cancelled") return false;
  if (to === "cancelled") return true;
  return (
    (from === "planned" && to === "running")
    || (from === "running" && to === "analyzing")
    || (from === "analyzing" && to === "completed")
  );
}
