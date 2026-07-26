import { isRecord } from "@/lib/shared/coerce";

import {
  parseWorkPatternExperimentMetadata,
  type WorkPatternExperimentLifecycle,
  type WorkPatternExperimentMetadataV1,
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

export type WorkPatternExperimentAnalyzedCell = {
  status: string;
  pairKey: string;
  methodVariantKey: string;
  modelVariantKey: string;
  success: boolean;
  requestedProviderId: string;
  requestedModelId: string;
  actualProviderId: string;
  actualModelId: string;
  fixtureKey: string;
  sourceCommitSha: string;
  taskCorpusKey: string;
  taskCorpusVersion: string;
  oracleKey: string;
  oracleVersion: string;
  resourcePolicyKey: string;
};

export type WorkPatternExperimentAnalysis = {
  validPairCount: number;
  resultSummary: string;
  evidenceOrigin: "hermetic-replay";
  moreEvidenceNeeded: boolean;
  invalidPairReasons: string[];
  freshnessAt: string;
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

function comparisonFingerprint(cell: WorkPatternExperimentAnalyzedCell): string {
  return [
    cell.fixtureKey,
    cell.sourceCommitSha,
    cell.taskCorpusKey,
    cell.taskCorpusVersion,
    cell.oracleKey,
    cell.oracleVersion,
    cell.resourcePolicyKey,
  ].join("\u001f");
}

/**
 * Projects terminal child evidence into the parent without changing any
 * authority, delivery, or activation substrate. The first declared method is
 * the baseline; every later method is compared with it within the same
 * pair/model cell.
 */
export function analyzeWorkPatternExperimentCells(
  manifest: WorkPatternExperimentMetadataV1,
  cells: readonly WorkPatternExperimentAnalyzedCell[],
  now = new Date(),
): WorkPatternExperimentAnalysis {
  const baseline = manifest.methodVariants[0]?.methodVariantKey;
  const candidates = manifest.methodVariants
    .slice(1)
    .map((variant) => variant.methodVariantKey);
  const invalidReasons = new Set<string>();
  let validPairCount = 0;

  if (!baseline || candidates.length === 0) {
    invalidReasons.add("A baseline and candidate method are required.");
  }

  for (const model of manifest.modelVariants) {
    for (const candidate of candidates) {
      const baselineCells = cells.filter(
        (cell) =>
          cell.modelVariantKey === model.modelVariantKey
          && cell.methodVariantKey === baseline,
      );
      const candidateCells = cells.filter(
        (cell) =>
          cell.modelVariantKey === model.modelVariantKey
          && cell.methodVariantKey === candidate,
      );
      if (baselineCells.length !== 1 || candidateCells.length !== 1) {
        invalidReasons.add(`Missing or duplicate pair for ${candidate}/${model.modelVariantKey}.`);
        continue;
      }
      const [baselineCell] = baselineCells;
      const [candidateCell] = candidateCells;
      if (
        baselineCell.status !== "completed"
        || candidateCell.status !== "completed"
        || !baselineCell.success
        || !candidateCell.success
      ) {
        invalidReasons.add(`Non-passing pair for ${candidate}/${model.modelVariantKey}.`);
        continue;
      }
      if (baselineCell.pairKey !== candidateCell.pairKey) {
        invalidReasons.add(`Pair identity mismatch for ${candidate}/${model.modelVariantKey}.`);
        continue;
      }
      if (comparisonFingerprint(baselineCell) !== comparisonFingerprint(candidateCell)) {
        invalidReasons.add(`Evidence controls differ for ${candidate}/${model.modelVariantKey}.`);
        continue;
      }
      const actualModelsMatch =
        baselineCell.actualProviderId === baselineCell.requestedProviderId
        && baselineCell.actualModelId === baselineCell.requestedModelId
        && candidateCell.actualProviderId === candidateCell.requestedProviderId
        && candidateCell.actualModelId === candidateCell.requestedModelId;
      if (!actualModelsMatch) {
        invalidReasons.add(`Provider or model fallback changed ${candidate}/${model.modelVariantKey}.`);
        continue;
      }
      validPairCount += 1;
    }
  }

  const expectedPairCount = manifest.modelVariants.length * candidates.length;
  const moreEvidenceNeeded =
    expectedPairCount === 0 || validPairCount < expectedPairCount;
  return {
    validPairCount,
    resultSummary:
      validPairCount === 0
        ? "No comparable experiment pairs passed the evidence controls."
        : `${validPairCount} of ${expectedPairCount} comparable method pairs passed the evidence controls.`,
    evidenceOrigin: "hermetic-replay",
    moreEvidenceNeeded,
    invalidPairReasons: [...invalidReasons],
    freshnessAt: now.toISOString(),
  };
}
