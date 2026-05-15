import type {
  DiscoveryEvidencePacket,
  DiscoveryTriageScore,
} from "@dpf/db/discovery-triage";
import { DISCOVERY_TRIAGE_AGENT_ID } from "@dpf/db";
import { z } from "zod";

import { loadPrompt } from "@/lib/tak/prompt-loader";
import {
  assertEgressAllowlist,
  classifyReviewFailure,
  evaluateReviewerHealth,
  loadReviewSettings,
  validateAutonomousReviewDecisions,
  type AutoPauseTrigger,
  type ReviewFailureReason,
  type ReviewRunSummary,
  type ReviewSkipReason,
} from "@/lib/tak/bounded-autonomous-review";

export type { AutoPauseTrigger, ReviewFailureReason, ReviewSkipReason };

export const DISCOVERY_TRIAGE_REVIEW_BATCH_LIMIT = 12;

const DISCOVERY_TRIAGE_REVIEW_SETTING_PREFIX = "discovery-triage.review";
const REVIEWER_PROMPT_CATEGORY = "specialist";
const REVIEWER_PROMPT_SLUG = "discovery-triage-reviewer";

export const DISCOVERY_TRIAGE_REVIEW_CLASSIFICATIONS = [
  "accept_procedural_outcome",
  "force_human_review",
  "needs_more_evidence",
  "taxonomy_gap",
  "dismiss",
] as const;

export type DiscoveryTriageReviewClassification = typeof DISCOVERY_TRIAGE_REVIEW_CLASSIFICATIONS[number];

export type DiscoveryTriageReviewDecision = {
  inventoryEntityId: string;
  classification: DiscoveryTriageReviewClassification;
  confidence: "high" | "medium" | "low";
  rationale: string;
};

export type DiscoveryTriageDecisionOutcome =
  | "auto-attributed"
  | "human-review"
  | "taxonomy-gap"
  | "needs-more-evidence"
  | "dismissed";

type PublicDiscoveryTriageReviewEntity = {
  inventoryEntityId: string;
  entityType: string;
  name: string;
  proceduralOutcome: DiscoveryTriageDecisionOutcome;
  score: DiscoveryTriageScore;
  evidence: {
    independentSignalCount: number;
    hasSuitableTaxonomy: boolean;
    reproducibilityRunCount: number;
    observedSpanHours: number;
    redactionStatus: DiscoveryEvidencePacket["redactionStatus"];
  };
  candidateTaxonomy: DiscoveryEvidencePacket["candidateTaxonomy"];
  identityCandidates: DiscoveryEvidencePacket["identityCandidates"];
};

export type DiscoveryTriageReviewInput = {
  entities: PublicDiscoveryTriageReviewEntity[];
  allowedClassifications: readonly DiscoveryTriageReviewClassification[];
};

export type DiscoveryTriageReviewer = (input: DiscoveryTriageReviewInput) => Promise<unknown[]>;

export type DiscoveryTriageReviewContext = {
  entity: {
    id: string;
    entityType: string;
    name: string;
  };
  packet: DiscoveryEvidencePacket;
  score: DiscoveryTriageScore;
  proceduralOutcome: DiscoveryTriageDecisionOutcome;
  outcome: DiscoveryTriageDecisionOutcome;
  requiresHumanReview: boolean;
  boundedReview: DiscoveryTriageReviewDecision | null;
};

export type DiscoveryTriageReviewMetrics = {
  reviewed: number;
  reviewFailed: number;
  reviewFailureReason?: ReviewFailureReason;
  reviewSkipReason?: ReviewSkipReason;
  autoPauseTrigger?: AutoPauseTrigger | null;
  reviewBatchSize: number;
  reviewBatchUtilization: number;
  reviewParseSuccessRate: number;
  reviewSchemaDropCount: number;
  reviewLatencyMs: number | null;
  reviewClassificationHistogram: Partial<Record<DiscoveryTriageReviewClassification, number>>;
};

type DiscoveryTriageReviewDb = {
  platformConfig?: {
    findUnique(args: {
      where: { key: string };
      select?: { value?: boolean };
    }): Promise<{ value: unknown } | null>;
  };
  taskRun?: {
    findMany(args: Record<string, unknown>): Promise<Array<{ progressPayload: unknown }>>;
  };
};

const DiscoveryTriageReviewDecisionSchema = z.object({
  inventoryEntityId: z.string().min(1),
  classification: z.enum(DISCOVERY_TRIAGE_REVIEW_CLASSIFICATIONS),
  confidence: z.enum(["high", "medium", "low"]),
  rationale: z.string().min(1).max(280),
}).strict();

const FALLBACK_REVIEWER_PROMPT = [
  "You are the Discovery Triage bounded reviewer.",
  "Return ONLY a JSON array. One decision per entity.",
  "Each decision must contain inventoryEntityId, classification, confidence, and rationale.",
  "classification must be one of: accept_procedural_outcome, force_human_review, needs_more_evidence, taxonomy_gap, dismiss.",
  "Only classify already-ambiguous triage packets. Do not fetch, parse, dedupe, write, select providers, retry calls, or invent taxonomy nodes.",
  "If uncertain, use force_human_review.",
].join(" ");

export function requiresHumanReviewForOutcome(outcome: DiscoveryTriageDecisionOutcome): boolean {
  return outcome === "human-review" || outcome === "taxonomy-gap";
}

export function attachBoundedReview(
  packet: DiscoveryEvidencePacket,
  review: DiscoveryTriageReviewDecision | null,
): DiscoveryEvidencePacket {
  if (!review) return packet;
  return {
    ...packet,
    boundedReview: review,
  } as DiscoveryEvidencePacket;
}

function applyBoundedReviewOutcome(
  proceduralOutcome: DiscoveryTriageDecisionOutcome,
  review: DiscoveryTriageReviewDecision | null,
): DiscoveryTriageDecisionOutcome {
  switch (review?.classification) {
    case "force_human_review":
      return "human-review";
    case "needs_more_evidence":
      return "needs-more-evidence";
    case "taxonomy_gap":
      return "taxonomy-gap";
    case "dismiss":
      return "dismissed";
    case "accept_procedural_outcome":
    default:
      return proceduralOutcome;
  }
}

function incrementReviewClassification(
  histogram: Partial<Record<DiscoveryTriageReviewClassification, number>>,
  classification: DiscoveryTriageReviewClassification,
): void {
  histogram[classification] = (histogram[classification] ?? 0) + 1;
}

function readPayloadRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readReviewRunSummary(progressPayload: unknown): ReviewRunSummary | null {
  const progress = readPayloadRecord(progressPayload);
  const summaryPayload = readPayloadRecord(progress?.scheduledSummaryPayload);
  return readPayloadRecord(summaryPayload?.metrics);
}

function toPublicReviewEntity(context: DiscoveryTriageReviewContext): PublicDiscoveryTriageReviewEntity {
  return {
    inventoryEntityId: context.entity.id,
    entityType: context.entity.entityType,
    name: context.entity.name,
    proceduralOutcome: context.proceduralOutcome,
    score: {
      identityConfidence: context.score.identityConfidence,
      taxonomyConfidence: context.score.taxonomyConfidence,
      evidenceCompleteness: context.score.evidenceCompleteness,
      reproducibilityScore: context.score.reproducibilityScore,
      identityAmbiguityMargin: context.score.identityAmbiguityMargin,
      taxonomyAmbiguityMargin: context.score.taxonomyAmbiguityMargin,
    },
    evidence: {
      independentSignalCount: context.packet.independentSignalCount,
      hasSuitableTaxonomy: context.packet.hasSuitableTaxonomy,
      reproducibilityRunCount: context.packet.reproducibility.runCount,
      observedSpanHours: context.packet.reproducibility.observedSpanHours,
      redactionStatus: context.packet.redactionStatus,
    },
    candidateTaxonomy: context.packet.candidateTaxonomy.slice(0, 3),
    identityCandidates: context.packet.identityCandidates.slice(0, 3),
  };
}

function validateReviewDecisions(values: unknown[]): {
  decisions: DiscoveryTriageReviewDecision[];
  dropped: number;
} {
  const result = validateAutonomousReviewDecisions(DiscoveryTriageReviewDecisionSchema, values);
  return { decisions: result.decisions, dropped: result.dropped };
}

export async function applyDiscoveryTriageAutonomousReview(
  db: DiscoveryTriageReviewDb,
  input: {
    actorId: string | null;
    reviewer: DiscoveryTriageReviewer;
    contexts: DiscoveryTriageReviewContext[];
    metrics: DiscoveryTriageReviewMetrics;
  },
): Promise<void> {
  const reviewCandidates = input.contexts
    .filter((context) => context.proceduralOutcome !== "auto-attributed")
    .slice(0, DISCOVERY_TRIAGE_REVIEW_BATCH_LIMIT);

  if (reviewCandidates.length === 0) {
    input.metrics.reviewSkipReason = "no_candidates";
    input.metrics.reviewParseSuccessRate = 1;
    return;
  }

  const reviewSettings = await loadReviewSettings({
    namespace: DISCOVERY_TRIAGE_REVIEW_SETTING_PREFIX,
    platformConfig: db.platformConfig,
  });
  if (!reviewSettings.enabled) {
    input.metrics.reviewSkipReason = "operator_disabled";
    return;
  }

  const history = db.taskRun
    ? (await db.taskRun.findMany({
        where: {
          currentAgentId: input.actorId ?? DISCOVERY_TRIAGE_AGENT_ID,
          progressPayload: { not: null },
        },
        orderBy: { createdAt: "desc" },
        take: reviewSettings.healthWindowSize,
        select: { progressPayload: true },
      }))
        .map((run) => readReviewRunSummary(run.progressPayload))
        .filter((summary): summary is ReviewRunSummary => Boolean(summary))
    : [];
  const reviewerHealth = evaluateReviewerHealth({
    history,
    thresholds: {
      minParseRate: reviewSettings.minParseRate,
      maxUnknownFailuresInWindow: reviewSettings.maxUnknownFailuresInWindow,
      maxSingleClassFraction: reviewSettings.maxSingleClassFraction,
      healthWindowSize: reviewSettings.healthWindowSize,
    },
  });
  if (reviewerHealth.state === "auto_paused") {
    input.metrics.reviewSkipReason = "auto_paused";
    input.metrics.autoPauseTrigger = reviewerHealth.trigger;
    return;
  }

  input.metrics.reviewBatchSize = reviewCandidates.length;
  const reviewedEntityIds = new Set(reviewCandidates.map((context) => context.entity.id));
  const reviewInput: DiscoveryTriageReviewInput = {
    entities: reviewCandidates.map(toPublicReviewEntity),
    allowedClassifications: DISCOVERY_TRIAGE_REVIEW_CLASSIFICATIONS,
  };
  assertEgressAllowlist(reviewInput, ["entities", "allowedClassifications"]);

  const startedAt = Date.now();
  try {
    const rawDecisions = await input.reviewer(reviewInput);
    input.metrics.reviewLatencyMs = Date.now() - startedAt;
    const { decisions, dropped } = validateReviewDecisions(rawDecisions);
    const acceptedDecisions = decisions.filter((decision) => reviewedEntityIds.has(decision.inventoryEntityId));
    input.metrics.reviewSchemaDropCount = dropped + (decisions.length - acceptedDecisions.length);
    input.metrics.reviewParseSuccessRate = input.metrics.reviewBatchSize > 0
      ? acceptedDecisions.length / input.metrics.reviewBatchSize
      : 1;

    const contextByEntityId = new Map(reviewCandidates.map((context) => [context.entity.id, context]));
    for (const decision of acceptedDecisions) {
      const context = contextByEntityId.get(decision.inventoryEntityId);
      if (!context) continue;
      context.boundedReview = decision;
      context.outcome = applyBoundedReviewOutcome(context.proceduralOutcome, decision);
      context.requiresHumanReview = requiresHumanReviewForOutcome(context.outcome);
      input.metrics.reviewed += 1;
      incrementReviewClassification(input.metrics.reviewClassificationHistogram, decision.classification);
    }
  } catch (error) {
    input.metrics.reviewLatencyMs = Date.now() - startedAt;
    input.metrics.reviewFailed = reviewCandidates.length;
    input.metrics.reviewFailureReason = classifyReviewFailure(error);
  }
}

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array found in discovery triage review response");
    return JSON.parse(match[0]);
  }
}

export async function reviewDiscoveryTriageWithTak(
  input: DiscoveryTriageReviewInput,
): Promise<unknown[]> {
  const entities = input.entities.slice(0, DISCOVERY_TRIAGE_REVIEW_BATCH_LIMIT);
  if (entities.length === 0) return [];

  const { routeAndCall } = await import("@/lib/routed-inference");
  const systemPrompt = await loadPrompt(
    REVIEWER_PROMPT_CATEGORY,
    REVIEWER_PROMPT_SLUG,
    FALLBACK_REVIEWER_PROMPT,
  );
  const result = await routeAndCall(
    [
      {
        role: "user",
        content: JSON.stringify(
          {
            entities,
            allowedClassifications: input.allowedClassifications,
          },
          null,
          2,
        ),
      },
    ],
    systemPrompt,
    "internal",
    {
      taskType: "analysis",
      budgetClass: "minimize_cost",
      effort: "low",
      agentId: DISCOVERY_TRIAGE_AGENT_ID,
      agentDisplayName: "Product Manager",
      persistDecision: true,
    },
  );

  const parsed = extractJsonArray(result.content);
  return Array.isArray(parsed) ? parsed : [];
}
