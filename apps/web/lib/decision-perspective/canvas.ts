import type {
  DecisionDomainClass,
  DecisionEvidenceItem,
  DecisionOutcomeType,
  DecisionPerspectiveEvaluationResult,
  DecisionRiskTier,
} from "@/lib/decision-perspective/types";
import { decisionInteractionRowToEvaluation } from "./persistence";

export type DecisionCanvasContribution = {
  principleId: string;
  principleName: string;
  tier?: string | null;
  contribution: number;
  alignment?: number | null;
  sourceSlug?: string | null;
};

export type DecisionCanvasSource = {
  id: string;
  label: string;
  sourceType: string;
  summary: string;
  href?: string | null;
  weight?: number | null;
};

export type DecisionCanvasInput = {
  interactionId?: string | null;
  profileId?: string | null;
  profileLabel?: string | null;
  perspectiveMode?: "wwmd" | "wwwd" | "custom";
  profileVersionId?: string | null;
  routeContext?: string | null;
  createdAt?: Date | string | null;
  evaluation: DecisionPerspectiveEvaluationResult;
  recommendedOption?: string | null;
  contributions?: DecisionCanvasContribution[];
  evidence?: DecisionEvidenceItem[];
  sources?: DecisionCanvasSource[];
  humanOutcome?: {
    chosenOption?: string | null;
    rationale?: string | null;
    overrodeRecommendation?: boolean | null;
    recordedAt?: Date | string | null;
  } | null;
};

export type DecisionCanvasInteractionRow = Parameters<typeof decisionInteractionRowToEvaluation>[0] & {
  interactionId: string;
  routeContext?: string | null;
  createdAt?: Date | string | null;
  humanOutcome?: unknown;
  profile?: {
    profileId: string;
    name: string;
    kind: string;
  } | null;
};

export type DecisionCanvasViewModel = {
  header: {
    interactionId: string | null;
    profileId: string | null;
    profileLabel: string;
    perspectiveMode: "wwmd" | "wwwd" | "custom";
    question: string;
    domainClass: DecisionDomainClass;
    riskTier: DecisionRiskTier;
    routeContext: string | null;
    createdAt: string | null;
  };
  options: Array<{
    id: string;
    label: string;
    selected: boolean;
    humanSelected: boolean;
  }>;
  recommendation: {
    outcomeType: DecisionOutcomeType;
    recommendedOption: string | null;
    confidenceScore: number;
    confidenceLabel: "high" | "medium" | "low";
    state: "recommended" | "needs-review" | "blocked" | "deferred";
    operatorMessage: string;
    nextActionLabel: string;
  };
  materialPulls: {
    positive: DecisionCanvasContribution[];
    negative: DecisionCanvasContribution[];
    neutral: DecisionCanvasContribution[];
  };
  principlePulls: {
    positive: DecisionCanvasContribution[];
    negative: DecisionCanvasContribution[];
    neutral: DecisionCanvasContribution[];
  };
  evidence: Array<{
    label: string;
    sourceType: string;
    grade: string;
    summary: string;
  }>;
  sources: DecisionCanvasSource[];
  outcome: {
    hasHumanOutcome: boolean;
    chosenOption: string | null;
    rationale: string | null;
    overrodeRecommendation: boolean;
    recordedAt: string | null;
  };
  audit: {
    interactionId: string | null;
    profileId: string | null;
    profileVersionId: string | null;
    materialIds: string[];
    sourceIds: string[];
    rawRationale: string;
  };
};

const INTERNAL_TOKEN_PATTERN =
  /\b(mcp|principle_decide|wwmd_evaluate|wwmd_record_outcome|dpf-[a-z0-9-]+)\b/gi;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function sanitizeOperatorText(value: string, fallback: string): string {
  const text = value.trim().length > 0 ? value : fallback;
  return text
    .replace(INTERNAL_TOKEN_PATTERN, "the decision service")
    .replace(/\s+/g, " ")
    .trim();
}

function confidenceLabel(score: number): "high" | "medium" | "low" {
  if (score >= 0.7) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function stateFor(input: DecisionPerspectiveEvaluationResult): DecisionCanvasViewModel["recommendation"]["state"] {
  if (input.principleConflict) return "blocked";
  if (input.outcomeType === "defer") return "deferred";
  if (input.outcomeType === "escalate") return "needs-review";
  return "recommended";
}

function nextActionFor(
  state: DecisionCanvasViewModel["recommendation"]["state"],
  outcomeType: DecisionOutcomeType,
  mode: DecisionCanvasViewModel["header"]["perspectiveMode"],
): string {
  if (state === "blocked") return "Resolve blocker before continuing";
  if (outcomeType === "defer") {
    return mode === "wwmd" ? "Send to founder review" : "Send to owner review";
  }
  if (outcomeType === "escalate") return "Ask for human decision";
  return "Use recommended option";
}

function inferRecommendedOption(
  evaluation: DecisionPerspectiveEvaluationResult,
  explicit: string | null | undefined,
): string | null {
  if (evaluation.outcomeType === "defer" || evaluation.outcomeType === "escalate") {
    return null;
  }
  if (explicit && evaluation.options.includes(explicit)) {
    return explicit;
  }
  const rationale = evaluation.rationale.toLowerCase();
  return (
    evaluation.options.find((option) => rationale.includes(option.toLowerCase())) ??
    null
  );
}

function contributionsFromEvaluation(
  evaluation: DecisionPerspectiveEvaluationResult,
): DecisionCanvasContribution[] {
  return evaluation.sources.map((source) => ({
    principleId: source.materialId,
    principleName: source.summary,
    tier: null,
    contribution: source.effectiveWeight,
    alignment: null,
    sourceSlug: null,
  }));
}

function sourcesFromEvaluation(
  evaluation: DecisionPerspectiveEvaluationResult,
): DecisionCanvasSource[] {
  return evaluation.sources.map((source) => ({
    id: source.materialId,
    label: source.summary,
    sourceType: source.sourceType,
    summary: source.summary,
    weight: source.effectiveWeight,
  }));
}

function perspectiveModeForProfile(profile: DecisionCanvasInteractionRow["profile"]) {
  const name = (profile?.name ?? "").toLowerCase();
  if (profile?.kind === "platform" || name.includes("wwmd")) return "wwmd";
  if (
    profile?.kind === "organization" ||
    profile?.kind === "customer" ||
    profile?.kind === "team" ||
    name.includes("wwwd")
  ) {
    return "wwwd";
  }
  return "custom";
}

function humanOutcomeFrom(value: unknown): DecisionCanvasInput["humanOutcome"] {
  const record = asRecord(value);
  const recordedAt = record.recordedAt ?? record.createdAt ?? null;
  return Object.keys(record).length > 0
    ? {
      chosenOption: typeof record.chosenOption === "string" ? record.chosenOption : null,
      rationale: typeof record.rationale === "string" ? record.rationale : null,
      overrodeRecommendation: record.overrodeRecommendation === true,
      recordedAt: typeof recordedAt === "string" || recordedAt instanceof Date ? recordedAt : null,
    }
    : null;
}

export function fromDecisionInteractionRow(row: DecisionCanvasInteractionRow): DecisionCanvasInput {
  const evaluation = decisionInteractionRowToEvaluation(row);
  return {
    interactionId: row.interactionId,
    profileId: row.profileId,
    profileLabel: row.profile?.name ?? "Decision Perspective",
    perspectiveMode: perspectiveModeForProfile(row.profile),
    profileVersionId: row.profileVersionId,
    routeContext: row.routeContext ?? null,
    createdAt: row.createdAt ?? null,
    evaluation,
    humanOutcome: humanOutcomeFrom(row.humanOutcome),
  };
}

function splitContributions(contributions: DecisionCanvasContribution[]) {
  const sorted = [...contributions].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );

  return {
    positive: sorted.filter((item) => item.contribution > 0),
    negative: sorted.filter((item) => item.contribution < 0),
    neutral: sorted.filter((item) => item.contribution === 0),
  };
}

export function projectDecisionCanvas(
  input: DecisionCanvasInput,
): DecisionCanvasViewModel {
  const evaluation = input.evaluation;
  const recommendedOption = inferRecommendedOption(
    evaluation,
    input.recommendedOption,
  );
  const perspectiveMode = input.perspectiveMode ?? "custom";
  const humanChosen = input.humanOutcome?.chosenOption ?? null;
  const state = stateFor(evaluation);
  const nextActionLabel = nextActionFor(
    state,
    evaluation.outcomeType,
    perspectiveMode,
  );
  const operatorMessage =
    state === "recommended"
      ? `${evaluation.outcomeType} (${evaluation.confidenceScore.toFixed(2)}): ${recommendedOption ?? "no clear option"}`
      : `${evaluation.outcomeType} (${evaluation.confidenceScore.toFixed(2)}): ${nextActionLabel}`;

  const contributions =
    input.contributions ?? contributionsFromEvaluation(evaluation);
  const sourceRows = input.sources ?? sourcesFromEvaluation(evaluation);
  const materialPulls = splitContributions(contributions);

  return {
    header: {
      interactionId: input.interactionId ?? null,
      profileId: input.profileId ?? evaluation.selectedProfileId,
      profileLabel: input.profileLabel ?? "Decision Perspective",
      perspectiveMode,
      question: evaluation.question,
      domainClass: evaluation.domainClass,
      riskTier: evaluation.riskTier,
      routeContext: input.routeContext ?? null,
      createdAt: toIso(input.createdAt),
    },
    options: evaluation.options.map((option) => ({
      id: option,
      label: option,
      selected: recommendedOption === option,
      humanSelected: humanChosen === option,
    })),
    recommendation: {
      outcomeType: evaluation.outcomeType,
      recommendedOption,
      confidenceScore: evaluation.confidenceScore,
      confidenceLabel: confidenceLabel(evaluation.confidenceScore),
      state,
      operatorMessage: sanitizeOperatorText(operatorMessage, nextActionLabel),
      nextActionLabel,
    },
    materialPulls,
    principlePulls: materialPulls,
    evidence: (input.evidence ?? []).map((item) => ({
      label: item.label,
      sourceType: item.sourceType,
      grade: item.grade,
      summary: sanitizeOperatorText(item.summary, "Evidence supplied."),
    })),
    sources: sourceRows.map((source) => ({
      ...source,
      label: sanitizeOperatorText(source.label, "Source"),
      summary: sanitizeOperatorText(source.summary, "Source summary"),
    })),
    outcome: {
      hasHumanOutcome: Boolean(input.humanOutcome),
      chosenOption: humanChosen,
      rationale: input.humanOutcome?.rationale
        ? sanitizeOperatorText(input.humanOutcome.rationale, "")
        : null,
      overrodeRecommendation:
        input.humanOutcome?.overrodeRecommendation === true,
      recordedAt: toIso(input.humanOutcome?.recordedAt),
    },
    audit: {
      interactionId: input.interactionId ?? null,
      profileId: input.profileId ?? evaluation.selectedProfileId,
      profileVersionId: input.profileVersionId ?? evaluation.profileVersionId,
      materialIds: evaluation.materialScores.map((score) => score.materialId),
      sourceIds: sourceRows.map((source) => source.id),
      rawRationale: evaluation.rationale,
    },
  };
}
