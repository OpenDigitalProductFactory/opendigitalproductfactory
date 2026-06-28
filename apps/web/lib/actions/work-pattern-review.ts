"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@dpf/db";
import { requireCapability } from "@/lib/actions/shared/guards";
import { MARK_DPF_PLATFORM_PROFILE } from "@/lib/decision-perspective/default-profile";
import { createDecisionInteractionId } from "@/lib/decision-perspective/persistence";
import type {
  DecisionOutcomeType,
  DecisionRiskTier,
} from "@/lib/decision-perspective/types";
import {
  COWORKER_CAPABILITY_NEED_KINDS,
  type CoworkerCapabilityNeedKind,
} from "@/lib/coworker-self-assessment/types";
import {
  evaluateWorkPatternShadowEvidence,
  parseAutonomyLevel,
  parseRiskClass,
  parseWorkPatternShadowTrials,
} from "@/lib/tak/work-pattern-shadow-evaluation";
import {
  buildWorkPatternReview,
  capabilityNeedStatusForReviewAction,
  mergeWorkPatternReviewState,
  WORK_PATTERN_REVIEW_ACTIONS,
  type WorkPatternReviewAction,
} from "@/lib/tak/work-pattern-review";
import { buildWorkPatternCaseStaging } from "@/lib/tak/work-pattern-case-staging";
import type {
  WorkPatternCandidate,
  WorkPatternDecisionScope,
} from "@/lib/tak/work-pattern-types";
import { parseWorkPatternMetadata } from "@/lib/tak/work-pattern-types";

type JsonRecord = Record<string, unknown>;

type ReviewNeedRow = {
  needId: string;
  agentId: string;
  kind: string;
  need: string;
  blocks: string;
  evidenceJson?: unknown;
  readinessJson?: unknown;
  linkedBacklogItemId?: string | null;
  assessment?: {
    routeContext?: string | null;
  } | null;
};

export type ReviewActionResult = {
  status: "recorded";
  action: WorkPatternReviewAction;
  needId: string;
  decisionInteractionId: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordFrom(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function stringField(source: unknown, field: string): string | null {
  if (!isRecord(source)) return null;
  const value = source[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function formString(formData: FormData, field: string): string | null {
  const value = formData.get(field);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseAction(value: string | null): WorkPatternReviewAction {
  if (WORK_PATTERN_REVIEW_ACTIONS.includes(value as WorkPatternReviewAction)) {
    return value as WorkPatternReviewAction;
  }
  throw new Error("invalid_work_pattern_review_action");
}

function knownKind(value: string): CoworkerCapabilityNeedKind {
  return COWORKER_CAPABILITY_NEED_KINDS.includes(value as CoworkerCapabilityNeedKind)
    ? value as CoworkerCapabilityNeedKind
    : "other";
}

function parseDecisionScope(value: string | null): WorkPatternDecisionScope {
  if (value === "company-wwwd" || value === "profession-wsid") return value;
  return "platform-wwmd";
}

function riskTierFor(riskClass: ReturnType<typeof parseRiskClass>): DecisionRiskTier {
  if (riskClass === "read-only") return "low";
  if (riskClass === "internal-irreversible") return "high";
  if (riskClass === "outbound-or-floor") return "critical";
  return "medium";
}

function outcomeTypeFor(action: WorkPatternReviewAction): DecisionOutcomeType {
  if (action === "approve") return "recommend";
  if (action === "defer") return "defer";
  return "escalate";
}

function appendString(values: unknown, next: string): string[] {
  const existing = Array.isArray(values)
    ? values.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
  return [...new Set([...existing, next])];
}

function evidenceSources(input: {
  need: ReviewNeedRow;
  evidenceJson: JsonRecord;
}): Array<{ materialId: string; sourceType: string; summary: string; effectiveWeight: number }> {
  const sources: Array<{ materialId: string; sourceType: string; summary: string; effectiveWeight: number }> = [
    {
      materialId: input.need.needId,
      sourceType: "coworker-capability-need",
      summary: input.need.need,
      effectiveWeight: 1,
    },
  ];
  const taskRunId = stringField(input.evidenceJson, "taskRunId");
  if (taskRunId) {
    sources.push({
      materialId: taskRunId,
      sourceType: "task-run",
      summary: `TaskRun evidence for ${input.need.needId}.`,
      effectiveWeight: 0.7,
    });
  }
  const toolExecutionId = stringField(input.evidenceJson, "toolExecutionId");
  if (toolExecutionId) {
    sources.push({
      materialId: toolExecutionId,
      sourceType: "tool-execution",
      summary: `Tool execution evidence for ${input.need.needId}.`,
      effectiveWeight: 0.7,
    });
  }
  return sources;
}

function candidateFromNeed(need: ReviewNeedRow, evidenceJson: JsonRecord): WorkPatternCandidate {
  return {
    kind: knownKind(need.kind),
    need: need.need,
    blocks: need.blocks,
    fingerprint:
      stringField(evidenceJson, "fingerprint") ??
      `${need.agentId}|${need.kind}|${need.need.trim().toLowerCase().replace(/\s+/g, " ")}`,
    evaluationMethod: stringField(evidenceJson, "evaluationMethod") ?? "capability-need-review",
  };
}

function buildRoute(agentId: string): string {
  return `/platform/ai/agent/${agentId}`;
}

function workPatternMetadataFrom(
  evidenceJson: JsonRecord,
  readinessJson: JsonRecord,
) {
  return (
    parseWorkPatternMetadata(evidenceJson.workPattern) ??
    parseWorkPatternMetadata(readinessJson.workPattern)
  );
}

export async function recordWorkPatternReview(formData: FormData): Promise<ReviewActionResult> {
  const { userId } = await requireCapability("manage_platform");
  const needId = formString(formData, "needId");
  const formAgentId = formString(formData, "agentId");
  const action = parseAction(formString(formData, "action"));
  const note = formString(formData, "note");
  if (!needId || !formAgentId) {
    throw new Error("missing_work_pattern_review_input");
  }

  const need = await prisma.coworkerCapabilityNeed.findUnique({
    where: { needId },
    include: {
      assessment: {
        select: { routeContext: true },
      },
    },
  }) as ReviewNeedRow | null;
  if (!need) throw new Error("work_pattern_need_not_found");
  if (need.agentId !== formAgentId) throw new Error("work_pattern_need_agent_mismatch");

  const evidenceJson = recordFrom(need.evidenceJson);
  const readinessJson = recordFrom(need.readinessJson);
  const patternKey =
    stringField(evidenceJson, "patternKey") ?? stringField(readinessJson, "patternKey");
  if (!patternKey) throw new Error("work_pattern_missing_pattern_key");

  const shadowTrials = [
    ...parseWorkPatternShadowTrials(evidenceJson.shadowTrials),
    ...parseWorkPatternShadowTrials(readinessJson.shadowTrials),
  ];
  const currentLevel =
    parseAutonomyLevel(stringField(evidenceJson, "currentAutonomyLevel")) ??
    parseAutonomyLevel(stringField(readinessJson, "currentAutonomyLevel"));
  const regulatoryCeiling =
    parseAutonomyLevel(stringField(evidenceJson, "regulatoryCeiling")) ??
    parseAutonomyLevel(stringField(readinessJson, "regulatoryCeiling"));
  const shadowRiskClass =
    parseRiskClass(stringField(evidenceJson, "shadowRiskClass")) ??
    parseRiskClass(stringField(readinessJson, "shadowRiskClass")) ??
    parseRiskClass(stringField(evidenceJson, "riskClass")) ??
    parseRiskClass(stringField(readinessJson, "riskClass"));
  const shadowEvaluation = shadowTrials.length > 0
    ? evaluateWorkPatternShadowEvidence({
        trials: shadowTrials,
        currentLevel,
        regulatoryCeiling,
        riskClass: shadowRiskClass,
      })
    : null;
  const decisionInteractionId = createDecisionInteractionId();
  const decisionScope = parseDecisionScope(
    stringField(evidenceJson, "decisionScope") ?? stringField(readinessJson, "decisionScope"),
  );
  const review = buildWorkPatternReview({
    action,
    needId: need.needId,
    agentId: need.agentId,
    patternKey,
    routeContext: need.assessment?.routeContext ?? null,
    riskClass: shadowEvaluation?.riskClass ?? shadowRiskClass,
    decisionScope,
    candidate: candidateFromNeed(need, evidenceJson),
    shadowEvaluation,
    decisionInteractionId,
    reviewerUserId: userId,
    reviewedAt: new Date(),
    reviewerNote: note,
  });
  const caseStaging = buildWorkPatternCaseStaging({
    review,
    metadata: workPatternMetadataFrom(evidenceJson, readinessJson),
  });
  const reviewWithStaging =
    caseStaging.status === "not-case-bound"
      ? review
      : { ...review, caseStaging };
  const outcomeType = outcomeTypeFor(action);
  const routeContext = buildRoute(need.agentId);
  const confidence = shadowEvaluation?.agreementRate ?? 0;

  await prisma.$transaction(async (tx) => {
    await tx.decisionInteraction.create({
      data: {
        interactionId: decisionInteractionId,
        profileId: MARK_DPF_PLATFORM_PROFILE.profileId,
        profileVersionId: MARK_DPF_PLATFORM_PROFILE.currentVersion.versionId,
        fallbackProfileId: MARK_DPF_PLATFORM_PROFILE.fallbackProfileId,
        triggeredByUserId: userId,
        routeContext,
        phaseFrom: null,
        phaseTo: null,
        domainClass: "risk-assessment",
        question: `Review Living Playbook candidate "${need.need}" for ${need.agentId}?`,
        options: ["Approve scoped activation candidate", "Defer for more evidence", "Reject candidate"],
        evidenceBundle: inputJson({
          workPatternReview: reviewWithStaging,
          shadowEvaluation,
          capabilityNeedId: need.needId,
          linkedBacklogItemId: need.linkedBacklogItemId ?? null,
          materialCount: 0,
          freshnessDistribution: { current: 0, stale: 0, superseded: 0, contradicted: 0 },
          resolvedProfileChain: [MARK_DPF_PLATFORM_PROFILE.profileId],
        }),
        sources: evidenceSources({ need, evidenceJson }),
        rationale: note ?? `Operator recorded ${action} for Living Playbook candidate ${patternKey}.`,
        riskTier: riskTierFor(shadowEvaluation?.riskClass ?? shadowRiskClass),
        confidenceBefore: confidence,
        confidenceAfter: confidence,
        outcomeType,
        principleConflict: false,
        outcomePayload: inputJson({
          outcomeType,
          domainClass: "risk-assessment",
          confidenceScore: confidence,
          coverageGap: false,
          principleConflict: false,
          resolvedProfileChain: [MARK_DPF_PLATFORM_PROFILE.profileId],
          materialCount: 0,
          freshnessDistribution: { current: 0, stale: 0, superseded: 0, contradicted: 0 },
          workPatternReview: reviewWithStaging,
        }),
        humanOutcome: {
          type: "work-pattern-review",
          action,
          chosenOption:
            action === "approve"
              ? "Approve scoped activation candidate"
              : action === "defer"
                ? "Defer for more evidence"
                : "Reject candidate",
          rationale: note,
          resolverUserId: userId,
          recordedAt: reviewWithStaging.reviewedAt,
          clearsGate: false,
        },
      },
    });

    await tx.coworkerCapabilityNeed.update({
      where: { needId },
      data: {
        status: capabilityNeedStatusForReviewAction(action),
        reviewerNote: note,
        evidenceJson: {
          ...evidenceJson,
          decisionInteractionId,
          decisionInteractionIds: appendString(evidenceJson.decisionInteractionIds, decisionInteractionId),
        } as Prisma.InputJsonValue,
        readinessJson: mergeWorkPatternReviewState(readinessJson, reviewWithStaging) as Prisma.InputJsonValue,
      },
    });
  });

  revalidatePath(routeContext);
  return {
    status: "recorded",
    action,
    needId,
    decisionInteractionId,
  };
}

export async function reviewWorkPatternAction(formData: FormData): Promise<void> {
  await recordWorkPatternReview(formData);
}
