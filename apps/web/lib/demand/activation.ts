import {
  DEMAND_STAGE_VALUES,
  INVESTMENT_BUCKET_VALUES,
  type DemandScoreFramework,
  type DemandStage,
  type InvestmentBucket,
} from "../explore/backlog";
import {
  computeDemandScore,
  resolveJobSize,
  type DemandScoreInputs,
  type DemandScoreResult,
} from "./scoring";

export const DEMAND_ACTIVATION_STAGES = [
  "unclassified",
  ...DEMAND_STAGE_VALUES,
] as const;
export type DemandActivationStage = (typeof DEMAND_ACTIVATION_STAGES)[number];

export type DemandEstimateSource = "ai" | "human" | "agreed" | null;

export type DemandActivationInput = {
  demandStage: string | null;
  status: string;
  problemStatement: string | null;
  evidenceCount: number;
  framework: DemandScoreFramework;
  scoreInputs: DemandScoreInputs;
  investmentBucket: string | null;
  estimateSource: DemandEstimateSource;
  estimateAgreed: boolean | null;
  estimateDiverged: boolean;
  fundingDecisionAllowed: boolean;
};

export type DemandScoreExplanation = DemandScoreResult & {
  confidence: number | null;
  evidenceCount: number;
  effectiveJobSize: number | null;
  estimateSource: DemandEstimateSource;
  provisional: boolean;
};

export type DemandActivationReadiness = {
  classified: boolean;
  evidenceReady: boolean;
  scoreReady: boolean;
  fundingReady: boolean;
};

export type DemandActivationState = {
  stage: DemandActivationStage;
  nextStage: DemandStage | null;
  score: DemandScoreExplanation;
  readiness: DemandActivationReadiness;
  blockers: string[];
};

export type DemandTransitionFailureCode =
  | "invalid-transition"
  | "evidence-required"
  | "score-not-ready"
  | "funding-decision-required"
  | "rationale-required"
  | "funding-reconsideration-required";

export type DemandTransitionResult =
  | { allowed: true; from: DemandActivationStage; to: DemandStage }
  | {
      allowed: false;
      from: DemandActivationStage;
      to: DemandStage;
      code: DemandTransitionFailureCode;
      message: string;
    };

function stageOf(value: string | null): DemandActivationStage {
  return (DEMAND_STAGE_VALUES as readonly string[]).includes(value ?? "")
    ? (value as DemandStage)
    : "unclassified";
}

function validBucket(value: string | null): value is InvestmentBucket {
  return (INVESTMENT_BUCKET_VALUES as readonly string[]).includes(value ?? "");
}

function hasProblem(value: string | null): boolean {
  return Boolean(value?.trim());
}

export function buildDemandActivationState(
  input: DemandActivationInput,
): DemandActivationState {
  const stage = stageOf(input.demandStage);
  const computed = computeDemandScore(input.scoreInputs, input.framework);
  const effectiveJobSize = resolveJobSize(input.scoreInputs);
  const confidence =
    typeof input.scoreInputs.confidence === "number" &&
    Number.isFinite(input.scoreInputs.confidence)
      ? input.scoreInputs.confidence
      : null;
  const evidenceReady =
    hasProblem(input.problemStatement) && input.evidenceCount > 0;
  const provisional =
    input.estimateDiverged ||
    input.estimateSource === "ai" ||
    (input.estimateSource !== null && input.estimateAgreed === false);
  const scoreReady =
    computed.score !== null &&
    confidence !== null &&
    effectiveJobSize !== null &&
    input.estimateSource !== null &&
    !provisional &&
    validBucket(input.investmentBucket);
  const readiness: DemandActivationReadiness = {
    classified: stage !== "unclassified",
    evidenceReady,
    scoreReady,
    fundingReady: evidenceReady && scoreReady,
  };

  const blockers: string[] = [];
  if (!readiness.classified) {
    blockers.push("Classify this demand before shaping it.");
  }
  if (!hasProblem(input.problemStatement)) {
    blockers.push("State the customer or business problem.");
  }
  if (input.evidenceCount < 1) {
    blockers.push("Link at least one reviewed evidence source.");
  }
  if (computed.missing.length > 0) {
    blockers.push(`Add score inputs: ${computed.missing.join(", ")}.`);
  }
  if (confidence === null) {
    blockers.push("Record confidence for the value inputs.");
  }
  if (input.estimateSource === null) {
    blockers.push("Record who supplied the effort estimate.");
  }
  if (input.estimateDiverged) {
    blockers.push("Reconcile the AI and human effort estimates.");
  } else if (input.estimateSource === "ai") {
    blockers.push("Confirm or overrule the proposed AI effort estimate.");
  }
  if (!validBucket(input.investmentBucket)) {
    blockers.push("Choose an investment bucket.");
  }

  const nextStage =
    stage === "unclassified"
      ? "raw"
      : stage === "raw" && evidenceReady
        ? "screened"
        : stage === "screened" && scoreReady
          ? "shaped"
          : stage === "shaped" && input.fundingDecisionAllowed
            ? "ready"
            : null;

  return {
    stage,
    nextStage,
    score: {
      ...computed,
      confidence,
      evidenceCount: input.evidenceCount,
      effectiveJobSize,
      estimateSource: input.estimateSource,
      provisional,
    },
    readiness,
    blockers,
  };
}

const FORWARD_STAGE: Record<DemandActivationStage, DemandStage | null> = {
  unclassified: "raw",
  raw: "screened",
  screened: "shaped",
  shaped: "ready",
  ready: null,
};

const PREVIOUS_STAGE: Partial<Record<DemandStage, DemandStage>> = {
  screened: "raw",
  shaped: "screened",
};

function denied(
  from: DemandActivationStage,
  to: DemandStage,
  code: DemandTransitionFailureCode,
  message: string,
): DemandTransitionResult {
  return { allowed: false, from, to, code, message };
}

export function evaluateDemandTransition(
  input: DemandActivationInput,
  to: DemandStage,
  rationale?: string | null,
): DemandTransitionResult {
  const state = buildDemandActivationState(input);
  const from = state.stage;

  if (from === "ready" && to !== "ready") {
    return denied(
      from,
      to,
      "funding-reconsideration-required",
      "Funded demand must be reconsidered through the governed funding decision.",
    );
  }

  if (from !== "unclassified" && PREVIOUS_STAGE[from as DemandStage] === to) {
    if (!rationale?.trim()) {
      return denied(
        from,
        to,
        "rationale-required",
        "A rationale is required to move demand backward.",
      );
    }
    return { allowed: true, from, to };
  }

  if (FORWARD_STAGE[from] !== to) {
    return denied(
      from,
      to,
      "invalid-transition",
      `Demand cannot move directly from ${from} to ${to}.`,
    );
  }

  if (to === "screened" && !state.readiness.evidenceReady) {
    return denied(
      from,
      to,
      "evidence-required",
      "A stated problem and at least one reviewed evidence source are required.",
    );
  }
  if (to === "shaped" && !state.readiness.scoreReady) {
    return denied(
      from,
      to,
      "score-not-ready",
      state.blockers.join(" "),
    );
  }
  if (to === "ready" && !state.readiness.evidenceReady) {
    return denied(
      from,
      to,
      "evidence-required",
      "A stated problem and at least one reviewed evidence source are required.",
    );
  }
  if (to === "ready" && !state.readiness.scoreReady) {
    return denied(
      from,
      to,
      "score-not-ready",
      state.blockers.join(" "),
    );
  }
  if (to === "ready" && !input.fundingDecisionAllowed) {
    return denied(
      from,
      to,
      "funding-decision-required",
      "The organization-governed funding decision is required.",
    );
  }

  return { allowed: true, from, to };
}
