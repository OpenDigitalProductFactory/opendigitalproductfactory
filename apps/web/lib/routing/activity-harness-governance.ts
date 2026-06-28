import type {
  ActivityHarnessCalibration,
  ActivityHarnessCalibrationRecommendation,
} from "./activity-harness-calibration";
import type { HarnessRecipeConfidence } from "./harness-recipe";

export type ActivityHarnessGovernedAction = Extract<
  ActivityHarnessCalibrationRecommendation,
  "promote" | "degrade"
>;

export type ActivityHarnessActionProposal = {
  proposalId: string;
  action: ActivityHarnessGovernedAction;
  status: "proposed";
  approvalRequired: true;
  activityClass: string;
  harnessRecipeKey: string;
  providerId: string;
  modelId: string | null;
  currentConfidence: HarnessRecipeConfidence;
  recommendedConfidence: HarnessRecipeConfidence;
  summary: string;
  rationale: string;
  evidence: {
    sampleCount: number;
    linkedSampleCount: number;
    successRate: number;
    failureRate: number;
    retryRate: number;
    avgQualitySignal: number | null;
    avgCostUsd: number | null;
    avgTokenTotal: number | null;
  };
};

export type ActivityHarnessActionDecision =
  | {
      proposal: ActivityHarnessActionProposal;
      decision: "pending";
    }
  | {
      proposal: ActivityHarnessActionProposal;
      decision: "approved";
      decidedBy: string;
      decidedAt: Date;
    }
  | {
      proposal: ActivityHarnessActionProposal;
      decision: "rejected";
      decidedBy: string;
      decidedAt: Date;
    };

export type ActivityHarnessConfidenceOverride = {
  calibrationKey: string;
  proposalId: string;
  activityClass: string;
  harnessRecipeKey: string;
  providerId: string;
  modelId: string | null;
  confidence: HarnessRecipeConfidence;
  approvedBy: string;
  approvedAt: string;
};

export function buildActivityHarnessActionProposals(
  calibrations: ActivityHarnessCalibration[],
): ActivityHarnessActionProposal[] {
  return calibrations
    .filter((calibration): calibration is ActivityHarnessCalibration & {
      recommendation: ActivityHarnessGovernedAction;
    } => calibration.recommendation === "promote" || calibration.recommendation === "degrade")
    .map((calibration) => ({
      proposalId: proposalIdFor(calibration),
      action: calibration.recommendation,
      status: "proposed",
      approvalRequired: true,
      activityClass: calibration.activityClass,
      harnessRecipeKey: calibration.harnessRecipeKey,
      providerId: calibration.providerId,
      modelId: calibration.modelId,
      currentConfidence: calibration.currentConfidence,
      recommendedConfidence: calibration.recommendedConfidence,
      summary: summaryFor(calibration),
      rationale: calibration.rationale,
      evidence: {
        sampleCount: calibration.sampleCount,
        linkedSampleCount: calibration.linkedSampleCount,
        successRate: calibration.successRate,
        failureRate: calibration.failureRate,
        retryRate: calibration.retryRate,
        avgQualitySignal: calibration.avgQualitySignal,
        avgCostUsd: calibration.avgCostUsd,
        avgTokenTotal: calibration.avgTokenTotal,
      },
    }));
}

export function applyApprovedActivityHarnessActions(
  decisions: ActivityHarnessActionDecision[],
): ActivityHarnessConfidenceOverride[] {
  return decisions
    .filter(isApprovedActionDecision)
    .map((decision) => ({
      calibrationKey: calibrationKeyFor(decision.proposal),
      proposalId: decision.proposal.proposalId,
      activityClass: decision.proposal.activityClass,
      harnessRecipeKey: decision.proposal.harnessRecipeKey,
      providerId: decision.proposal.providerId,
      modelId: decision.proposal.modelId,
      confidence: decision.proposal.recommendedConfidence,
      approvedBy: decision.decidedBy,
      approvedAt: decision.decidedAt.toISOString(),
    }));
}

function isApprovedActionDecision(
  decision: ActivityHarnessActionDecision,
): decision is Extract<ActivityHarnessActionDecision, { decision: "approved" }> {
  return decision.decision === "approved";
}

function proposalIdFor(calibration: ActivityHarnessCalibration): string {
  return [
    "harness-action",
    calibration.activityClass,
    calibration.harnessRecipeKey,
    calibration.providerId,
    calibration.modelId ?? "unknown-model",
    calibration.recommendation,
  ].join(":");
}

function calibrationKeyFor(proposal: ActivityHarnessActionProposal): string {
  return [
    proposal.activityClass,
    proposal.harnessRecipeKey,
    proposal.providerId,
    proposal.modelId ?? "unknown-model",
  ].join("|");
}

function summaryFor(calibration: ActivityHarnessCalibration): string {
  const action = calibration.recommendation === "promote"
    ? "Promote"
    : "Degrade";
  return `${action} ${calibration.harnessRecipeKey} for ${calibration.activityClass} on ${calibration.providerId}/${calibration.modelId ?? "unknown model"} after approval.`;
}
