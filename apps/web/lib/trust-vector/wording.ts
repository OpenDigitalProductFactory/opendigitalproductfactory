import type { TrustAssessment } from "./types";

export type TrustMessageOptions = {
  currentFact?: string;
  lastKnownFact?: string;
  inferredResult?: string;
  lowConfidenceResult?: string;
  fallback?: string;
};

export function buildTrustMessage(
  assessment: TrustAssessment,
  options: TrustMessageOptions = {},
): string {
  if (assessment.statementKind === "current-fact" && assessment.action === "present") {
    return normalizeSentence(options.currentFact ?? options.fallback ?? assessment.summary);
  }

  const base = normalizeSentence(baseMessageForAssessment(assessment, options));
  const rationale = normalizeSentence(assessment.primaryRationale);

  if (base === rationale || base.includes(rationale)) {
    return base;
  }

  return `${base} ${rationale}`;
}

function baseMessageForAssessment(
  assessment: TrustAssessment,
  options: TrustMessageOptions,
): string {
  switch (assessment.statementKind) {
    case "current-fact":
      return options.currentFact ?? options.fallback ?? assessment.summary;
    case "last-known-fact":
      return options.lastKnownFact ?? options.currentFact ?? options.fallback ?? `${assessment.subject.label} is a last-known fact.`;
    case "inferred-result":
      return options.inferredResult ?? options.fallback ?? `${assessment.subject.label} is inferred.`;
    case "low-confidence-result":
      return options.lowConfidenceResult ?? options.fallback ?? `${assessment.subject.label} is low confidence.`;
  }
}

function normalizeSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
