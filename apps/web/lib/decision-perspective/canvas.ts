import type {
  DecisionDomainClass,
  DecisionEvidenceItem,
  DecisionOutcomeType,
  DecisionPerspectiveEvaluationResult,
  DecisionRiskTier,
} from "@/lib/decision-perspective/types";
import type { WikiPerspective } from "@/lib/wiki/perspective-intent";
import { decisionInteractionRowToEvaluation } from "./persistence";

// `WikiPerspective` is the canonical perspective enum, owned by PR #1343 at
// `apps/web/lib/wiki/perspective-intent.ts`. Do not redeclare locally — every
// projection that names WWMD vs WWWD must import from there so the codebase has
// exactly one source of truth (`single-source-of-truth`,
// `substrate-cleanup-before-substrate-addition`). When the spec's `"custom"`
// fallback is meant, use `WikiPerspective | null`; `null` means "neither WWMD
// nor WWWD" — do not add a sibling `"custom"` literal.

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
  /** `null` means a profile that is neither WWMD nor WWWD. Do not pass `"custom"`. */
  perspective?: WikiPerspective | null;
  /**
   * When true, render the "seeded from WWMD doctrine" caveat in the
   * recommendation block. Per PR #1343: WWWD currently falls back to platform
   * WWMD doctrine because product == business for DPF, and operators must not
   * mistake the fall-through for a settled WWWD position. If unset, the
   * projection infers it from `perspective === "wwwd"` plus
   * `resolvedProfileChain.length > 1`.
   */
  seededFromWwmd?: boolean;
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
    /** `null` means a profile that is neither WWMD nor WWWD. */
    perspective: WikiPerspective | null;
    /** See `DecisionCanvasInput.seededFromWwmd`. */
    seededFromWwmd: boolean;
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
    /**
     * Short note attached to the recommendation when the row's WWWD profile
     * has no own corpus and fell back to WWMD doctrine. Empty string when no
     * caveat applies. Matches PR #1343's prompt-hint caveat for the coworker.
     */
    caveat: string;
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
  perspective: WikiPerspective | null,
): string {
  if (state === "blocked") return "Resolve blocker before continuing";
  if (outcomeType === "defer") {
    // WWMD -> founder review (Mark's voice); WWWD or unspecified -> owner/operator review.
    return perspective === "wwmd" ? "Send to founder review" : "Send to owner review";
  }
  if (outcomeType === "escalate") return "Ask for an owner decision";
  return "Use recommended option";
}

const SEEDED_FROM_WWMD_CAVEAT =
  "Seeded from WWMD doctrine — the organization perspective has no approved material of its own yet.";

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

/**
 * Map a `DecisionPerspectiveProfile`-shaped row into the canonical
 * `WikiPerspective` enum from `lib/wiki/perspective-intent.ts` (PR #1343).
 *
 * Returns `null` for a profile that is neither WWMD nor WWWD (formerly the
 * `"custom"` sentinel). Exported so `lib/founder-review/queue.ts` and any
 * other caller share a single implementation rather than maintaining a
 * sibling copy.
 *
 * Callers that need a non-null default (e.g. the founder-review queue, where
 * a missing profile historically meant "treat as Mark's review") apply their
 * own `?? "wwmd"` at the call site.
 */
export function perspectiveForProfile(
  profile: { kind: string; name: string } | null | undefined,
): WikiPerspective | null {
  if (!profile) return null;
  const name = profile.name.toLowerCase();
  if (profile.kind === "platform" || name.includes("wwmd")) return "wwmd";
  if (
    profile.kind === "organization" ||
    profile.kind === "customer" ||
    profile.kind === "team" ||
    name.includes("wwwd")
  ) {
    return "wwwd";
  }
  return null;
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
    perspective: perspectiveForProfile(row.profile),
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
  const perspective = input.perspective ?? null;
  // WWWD currently falls back to platform/WWMD doctrine because product==business
  // for DPF (per PR #1343, BI-F5179C9E). When the caller hasn't explicitly set
  // the flag, infer it: WWWD selected AND the evaluator resolved through a
  // fallback profile chain.
  const seededFromWwmd =
    input.seededFromWwmd
      ?? (perspective === "wwwd" && (evaluation.resolvedProfileChain?.length ?? 0) > 1);
  const humanChosen = input.humanOutcome?.chosenOption ?? null;
  const state = stateFor(evaluation);
  const nextActionLabel = nextActionFor(
    state,
    evaluation.outcomeType,
    perspective,
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
      perspective,
      seededFromWwmd,
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
      caveat: seededFromWwmd ? SEEDED_FROM_WWMD_CAVEAT : "",
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
