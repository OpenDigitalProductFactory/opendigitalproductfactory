import { prisma } from "@dpf/db";
import type { Prisma, PrismaClient } from "@dpf/db";
import type { ReviewResult } from "@/lib/feature-build-types";

export type BranchVote = {
  roleSlug: string;
  confidence: number;
  criticalObjection: boolean;
  objectionText?: string;
};

export type ConsensusDecision = {
  decision: "approve" | "escalate" | "recommend";
  confidence: number;
  objections?: string[];
};

export type DeliberationSummary = {
  hitl: boolean;
  confidence: number;
  objections: string[];
  branches: BranchVote[];
};

const APPROVE_CONFIDENCE_THRESHOLD = 0.85;
const RECOMMEND_CONFIDENCE_THRESHOLD = 0.7;

export function computeConsensus(votes: BranchVote[]): ConsensusDecision {
  if (votes.length === 0) {
    return {
      decision: "escalate",
      confidence: 0,
      objections: ["no branches"],
    };
  }

  const criticals = votes.filter((vote) => vote.criticalObjection);
  if (criticals.length > 0) {
    return {
      decision: "escalate",
      confidence: 0,
      objections: criticals.map((vote) => vote.objectionText ?? vote.roleSlug),
    };
  }

  const confidences = votes.map((vote) => clampConfidence(vote.confidence));
  const confidence = roundConfidence(
    confidences.reduce((sum, voteConfidence) => sum + voteConfidence, 0) / confidences.length,
  );

  if (confidence >= APPROVE_CONFIDENCE_THRESHOLD) {
    return {
      decision: "approve",
      confidence,
    };
  }

  if (confidence >= RECOMMEND_CONFIDENCE_THRESHOLD) {
    return {
      decision: "recommend",
      confidence,
    };
  }

  return {
    decision: "escalate",
    confidence,
  };
}

type ApplyConsensusOutcomeParams = {
  buildId?: string | null;
  deliberationRunId?: string | null;
  consensusDecision: ConsensusDecision;
  branches: BranchVote[];
};

type FeatureBuildClient = Pick<PrismaClient, "featureBuild">;

export async function applyConsensusOutcome(
  params: ApplyConsensusOutcomeParams,
): Promise<ReviewResult>;
export async function applyConsensusOutcome(
  buildId: string,
  consensusDecision: ConsensusDecision,
  branches: BranchVote[],
  db?: FeatureBuildClient,
): Promise<ReviewResult>;
export async function applyConsensusOutcome(
  paramsOrBuildId: ApplyConsensusOutcomeParams | string,
  consensusDecision?: ConsensusDecision,
  branches?: BranchVote[],
  db: FeatureBuildClient = prisma,
): Promise<ReviewResult> {
  const params =
    typeof paramsOrBuildId === "string"
      ? {
          buildId: paramsOrBuildId,
          consensusDecision: requiredConsensusDecision(consensusDecision),
          branches: branches ?? [],
        }
      : paramsOrBuildId;
  const objections = params.consensusDecision.objections ?? [];
  const review: ReviewResult = {
    decision: params.consensusDecision.decision === "escalate" ? "fail" : "pass",
    issues: objections.map((description) => ({
      severity: "critical",
      description,
    })),
    summary: summarizeDecision(params.consensusDecision),
  };

  if (params.buildId) {
    const summary: DeliberationSummary = buildDeliberationSummary(
      params.consensusDecision,
      params.branches,
    );
    await db.featureBuild.update({
      where: { buildId: params.buildId },
      data: {
        deliberationSummary: summary as Prisma.InputJsonValue,
      },
    });
  }

  return review;
}

function requiredConsensusDecision(
  consensusDecision: ConsensusDecision | undefined,
): ConsensusDecision {
  if (!consensusDecision) {
    throw new Error("consensusDecision is required");
  }
  return consensusDecision;
}

function buildDeliberationSummary(
  consensusDecision: ConsensusDecision,
  branches: BranchVote[],
): DeliberationSummary {
  const objections = consensusDecision.objections ?? [];
  return {
    hitl: consensusDecision.decision === "escalate",
    confidence: consensusDecision.confidence,
    objections,
    branches,
  };
}

function summarizeDecision(decision: ConsensusDecision): string {
  switch (decision.decision) {
    case "approve":
      return `Consensus approved with ${decision.confidence} confidence.`;
    case "recommend":
      return `Consensus recommends proceeding with ${decision.confidence} confidence.`;
    case "escalate":
      return "Consensus requires an owner review.";
  }
}

function roundConfidence(value: number): number {
  return Number(value.toFixed(3));
}

function clampConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(1, confidence));
}
