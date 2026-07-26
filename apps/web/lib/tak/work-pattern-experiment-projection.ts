import { isRecord } from "@/lib/shared/coerce";

import {
  parseWorkPatternExperimentMetadata,
  type WorkPatternExperimentLifecycle,
} from "./work-pattern-experiment-types";

export type WorkPatternExperimentProjection = {
  label: "Testing a better method";
  lifecycle: WorkPatternExperimentLifecycle;
  patternKey: string;
  riskClass: string;
  maxPatternVersion: number;
  validPairCount: number;
  resultSummary: string;
  evidenceOrigin: "hermetic-replay" | "matched-cohort" | "unknown";
  moreEvidenceNeeded: boolean;
  invalidPairReasons: string[];
  methodVariants: string[];
  modelVariants: string[];
  installScope: string;
  taskCorpusVersion: string;
  oracleVersion: string;
  promotionPolicyVersion: number;
  freshnessAt: string | null;
  experimentRunId: string;
  experimentDefinitionKey: string;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
}

function validDateString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? value : null;
}

export function parseWorkPatternExperimentProjection(
  value: unknown,
): WorkPatternExperimentProjection | null {
  if (!isRecord(value)) return null;
  const manifest = parseWorkPatternExperimentMetadata(value.workPatternExperiment);
  if (!manifest) return null;
  const raw = isRecord(value.workPatternExperimentProjection)
    ? value.workPatternExperimentProjection
    : {};
  const origin = raw.evidenceOrigin;
  const evidenceOrigin =
    origin === "hermetic-replay" || origin === "matched-cohort"
      ? origin
      : "unknown";
  const validPairCount =
    typeof raw.validPairCount === "number"
    && Number.isInteger(raw.validPairCount)
    && raw.validPairCount >= 0
      ? raw.validPairCount
      : 0;

  return {
    label: "Testing a better method",
    lifecycle: manifest.lifecycle,
    patternKey: manifest.patternKey,
    riskClass: manifest.riskClass,
    maxPatternVersion: Math.max(
      ...manifest.methodVariants.map((variant) => variant.patternVersion),
    ),
    validPairCount,
    resultSummary:
      typeof raw.resultSummary === "string" && raw.resultSummary.trim().length > 0
        ? raw.resultSummary.trim()
        : "Experiment evidence is still being collected.",
    evidenceOrigin,
    moreEvidenceNeeded:
      typeof raw.moreEvidenceNeeded === "boolean"
        ? raw.moreEvidenceNeeded
        : true,
    invalidPairReasons: stringArray(raw.invalidPairReasons),
    methodVariants: manifest.methodVariants.map((variant) => variant.methodVariantKey),
    modelVariants: manifest.modelVariants.map((variant) => variant.modelVariantKey),
    installScope: manifest.installScope,
    taskCorpusVersion: manifest.taskCorpusVersion,
    oracleVersion: manifest.oracleVersion,
    promotionPolicyVersion: manifest.promotionPolicyVersion,
    freshnessAt: validDateString(raw.freshnessAt),
    experimentRunId: manifest.experimentRunId,
    experimentDefinitionKey: manifest.experimentDefinitionKey,
  };
}

export function hasWorkPatternExperimentCellMetadata(value: unknown): boolean {
  return isRecord(value) && isRecord(value.workPatternExperimentCell);
}
