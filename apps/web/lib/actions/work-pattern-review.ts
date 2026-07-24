"use server";

import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@dpf/db";
import { requireCapability } from "@/lib/actions/shared/guards";
import { MARK_DPF_PLATFORM_PROFILE } from "@/lib/decision-perspective/default-profile";
import { createDecisionInteractionId } from "@/lib/decision-perspective/persistence";
import { recommendOptionAgainstCommandments } from "@/lib/decision-perspective/option-recommendation";
import type {
  DecisionOutcomeType,
  DecisionRiskTier,
  DecisionScoredOption,
} from "@/lib/decision-perspective/types";
import {
  recordRegulatoryDecisionShadowEvidence,
  resolveRuntimeRegulatoryAutonomyCeiling,
  type RegulatoryAutonomyRuntimeDb,
  type RuntimeRegulatoryAutonomyCeiling,
} from "@/lib/autonomy/regulatory-autonomy-runtime";
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
  parseWorkPatternReviewState,
  WORK_PATTERN_REVIEW_ACTIONS,
  type WorkPatternReviewAction,
} from "@/lib/tak/work-pattern-review";
import { buildWorkPatternCaseStaging } from "@/lib/tak/work-pattern-case-staging";
import {
  buildWorkPatternCaseResolution,
  WORK_PATTERN_CASE_RESOLUTION_ACTIONS,
  type WorkPatternCaseResolutionAction,
} from "@/lib/tak/work-pattern-case-resolution";
import type {
  WorkPatternCandidate,
  WorkPatternDecisionScope,
} from "@/lib/tak/work-pattern-types";
import { parseWorkPatternMetadata } from "@/lib/tak/work-pattern-types";
import type { ReceiptEnvelope } from "@/lib/work-management/receipt-envelope";

type JsonRecord = Record<string, unknown>;

// BI-D88DFEEA Phase 1. Structural feature vectors for the two closed
// approve/defer/reject menus this file writes. Approving commits the
// candidate to production use now; deferring withholds judgment for more
// evidence, fully reversibly; rejecting declines it outright, also fully
// reversibly but with no further evidence-gathering. Feeds
// option-recommendation.ts so each row records which of the three the
// kernel's commandments would pick, alongside the human's actual
// approve/defer/reject call already captured in `action`/`chosenOption`.
function approveDeferRejectScoredOptions(
  approve: string,
  defer: string,
  reject: string,
): DecisionScoredOption[] {
  return [
    {
      id: "approve",
      description: approve,
      features: {
        speed_to_value: 0.8,
        reversibility: 0.35,
        blast_radius: 0.35,
        governance_compliance: 0.3,
        long_term_maintainability: 0.5,
        human_cognitive_load: 0.15,
      },
    },
    {
      id: "defer",
      description: defer,
      features: {
        speed_to_value: 0.3,
        reversibility: 0.9,
        blast_radius: 0.1,
        governance_compliance: 0.5,
        long_term_maintainability: 0.6,
        human_cognitive_load: 0.3,
      },
    },
    {
      id: "reject",
      description: reject,
      features: {
        speed_to_value: 0.2,
        reversibility: 0.95,
        blast_radius: 0.05,
        governance_compliance: 0.6,
        long_term_maintainability: 0.4,
        human_cognitive_load: 0.25,
      },
    },
  ];
}

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
  action: WorkPatternReviewAction | WorkPatternCaseResolutionAction;
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

function parseResolutionAction(value: string | null): WorkPatternCaseResolutionAction {
  if (WORK_PATTERN_CASE_RESOLUTION_ACTIONS.includes(value as WorkPatternCaseResolutionAction)) {
    return value as WorkPatternCaseResolutionAction;
  }
  throw new Error("invalid_work_pattern_case_resolution_action");
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
  const additions = next.trim().length > 0 ? [next] : [];
  return [...new Set([...existing, ...additions])];
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

function activityClassForReview(input: {
  evidenceJson: JsonRecord;
  readinessJson: JsonRecord;
  metadata: ReturnType<typeof workPatternMetadataFrom>;
  patternKey: string;
}): string {
  const explicit =
    stringField(input.evidenceJson, "activityClass") ??
    stringField(input.readinessJson, "activityClass");
  if (explicit) return explicit;

  const binding = input.metadata?.workCaseBinding;
  if (binding?.governedActionKey) {
    return `work-case.${binding.caseType ?? "case"}.${binding.governedActionKey}`;
  }

  return input.patternKey;
}

function regulatorySummary(runtime: RuntimeRegulatoryAutonomyCeiling | null): JsonRecord | null {
  if (!runtime) return null;
  return {
    activityClass: runtime.activityClass,
    industry: runtime.industry,
    ceiling: runtime.resolution.ceiling,
    defaulted: runtime.resolution.defaulted,
    humanControlRequired: runtime.resolution.humanControlRequired,
    requiredEvidence: runtime.resolution.requiredEvidence,
    matchedPolicyIds: runtime.resolution.matchedPolicies.map((policy) => policy.policyId),
    matchedBasis: runtime.resolution.matchedBasis,
    reason: runtime.resolution.reason,
  };
}

function receiptEnvelopeFromForm(input: {
  formData: FormData;
  staging: NonNullable<ReturnType<typeof parseWorkPatternReviewState>>["caseStaging"];
  decisionInteractionId: string;
  resolvedAt: Date;
}): ReceiptEnvelope | null {
  const receiptId = formString(input.formData, "receiptId");
  if (!receiptId || !input.staging) return null;
  const receiptStatus = formString(input.formData, "receiptStatus") ?? "valid";
  if (
    receiptStatus !== "valid" &&
    receiptStatus !== "invalid" &&
    receiptStatus !== "observed" &&
    receiptStatus !== "failed"
  ) {
    throw new Error("invalid_work_pattern_case_receipt_status");
  }
  const enforcementMode =
    formString(input.formData, "receiptEnforcementMode") ?? input.staging.enforcementMode;
  if (enforcementMode !== "governed-action" && enforcementMode !== "observed-event") {
    throw new Error("invalid_work_pattern_case_receipt_enforcement_mode");
  }
  const receiptKind =
    formString(input.formData, "receiptKind") ?? input.staging.requiredReceiptKind ?? enforcementMode;
  return {
    receiptId,
    caseRef: input.staging.caseRef,
    receiptKind,
    enforcementMode,
    sourceRef: {
      kind: "decision-interaction",
      id: input.decisionInteractionId,
      status: "approved",
    },
    actionType: input.staging.action,
    status: receiptStatus,
    summary: "Receipt evidence supplied for governed Living Playbook Work Case proposal resolution.",
    occurredAt: input.resolvedAt.toISOString(),
    policyRefs: input.staging.action ? [`work-case.${input.staging.action}`] : [],
    rawRef: {
      table: "ToolExecutionReceipt",
      id: receiptId,
    },
  };
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
  const metadata = workPatternMetadataFrom(evidenceJson, readinessJson);
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
  const activityClass = activityClassForReview({
    evidenceJson,
    readinessJson,
    metadata,
    patternKey,
  });
  const reviewedAt = new Date();
  const runtimeRegulatory = shadowTrials.length > 0
    ? await resolveRuntimeRegulatoryAutonomyCeiling(prisma as unknown as RegulatoryAutonomyRuntimeDb, {
        activityClass,
        asOf: reviewedAt,
      })
    : null;
  const effectiveRegulatoryCeiling =
    runtimeRegulatory?.resolution.ceiling ?? regulatoryCeiling;
  const shadowEvaluation = shadowTrials.length > 0
    ? evaluateWorkPatternShadowEvidence({
        trials: shadowTrials,
        currentLevel,
        regulatoryCeiling: effectiveRegulatoryCeiling,
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
    reviewedAt,
    reviewerNote: note,
  });
  const caseStaging = buildWorkPatternCaseStaging({
    review,
    metadata,
  });
  const reviewWithStaging =
    caseStaging.status === "not-case-bound"
      ? review
      : { ...review, caseStaging };
  const outcomeType = outcomeTypeFor(action);
  const routeContext = buildRoute(need.agentId);
  const confidence = shadowEvaluation?.agreementRate ?? 0;
  const scoredOptions = approveDeferRejectScoredOptions(
    "Approve scoped activation candidate",
    "Defer for more evidence",
    "Reject candidate",
  );
  // BI-D88DFEEA Phase 1: which of the three would the kernel's commandments
  // pick? Recorded alongside the human's actual `action` below so the
  // weight-inference adapter can compare them once enough rows accumulate.
  const recommendedOptionId = await recommendOptionAgainstCommandments({
    db: prisma,
    scoredOptions,
  });

  await prisma.$transaction(async (tx) => {
    await tx.decisionInteraction.create({
      data: {
        interactionId: decisionInteractionId,
        profileId: MARK_DPF_PLATFORM_PROFILE.profileId,
        profileVersionId: MARK_DPF_PLATFORM_PROFILE.currentVersion.versionId,
        fallbackProfileId: null,
        triggeredByUserId: userId,
        routeContext,
        phaseFrom: null,
        phaseTo: null,
        domainClass: "risk-assessment",
        question: `Review Living Playbook candidate "${need.need}" for ${need.agentId}?`,
        options: ["Approve scoped activation candidate", "Defer for more evidence", "Reject candidate"],
        scoredOptions,
        recommendedOptionId,
        chosenOptionId: action,
        evidenceBundle: inputJson({
          workPatternReview: reviewWithStaging,
          shadowEvaluation,
          runtimeRegulatoryAutonomy: regulatorySummary(runtimeRegulatory),
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
          runtimeRegulatoryAutonomy: regulatorySummary(runtimeRegulatory),
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

    if (runtimeRegulatory && shadowEvaluation?.riskClass && shadowTrials.length > 0) {
      await recordRegulatoryDecisionShadowEvidence(tx as unknown as RegulatoryAutonomyRuntimeDb, {
        agentId: need.agentId,
        activityType: activityClass,
        riskClass: shadowEvaluation.riskClass,
        currentLevel: shadowEvaluation.currentLevel,
        decisionInteractionId,
        taskRunId: stringField(evidenceJson, "taskRunId"),
        toolExecutionId: stringField(evidenceJson, "toolExecutionId"),
        regulatory: runtimeRegulatory,
        trials: shadowTrials,
      });
    }

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

export async function resolveWorkPatternCaseProposal(formData: FormData): Promise<ReviewActionResult> {
  const { userId } = await requireCapability("manage_platform");
  const needId = formString(formData, "needId");
  const formAgentId = formString(formData, "agentId");
  const action = parseResolutionAction(formString(formData, "action"));
  const note = formString(formData, "note");
  if (!needId || !formAgentId) {
    throw new Error("missing_work_pattern_case_resolution_input");
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
  const reviewState = parseWorkPatternReviewState(readinessJson);
  const staging = reviewState?.caseStaging ?? null;
  if (!reviewState || !staging || staging.status !== "stageable") {
    throw new Error("work_pattern_case_proposal_not_stageable");
  }
  const existingResolution = staging.resolution ?? null;
  const receiptCompletion =
    existingResolution?.status === "approved-awaiting-receipt" &&
    action === "approve" &&
    Boolean(formString(formData, "receiptId"));
  if (existingResolution && !receiptCompletion) {
    throw new Error("work_pattern_case_proposal_already_resolved");
  }

  const decisionInteractionId = createDecisionInteractionId();
  const resolvedAt = new Date();
  const receipt = receiptEnvelopeFromForm({
    formData,
    staging,
    decisionInteractionId,
    resolvedAt,
  });
  const resolution = buildWorkPatternCaseResolution({
    staging,
    action,
    decisionInteractionId,
    resolverUserId: userId,
    resolvedAt,
    note,
    receipt,
  });
  const reviewWithResolution = {
    ...reviewState,
    caseStaging: {
      ...staging,
      resolution,
    },
  };
  const updatedReadiness = {
    ...readinessJson,
    workPatternReview: reviewWithResolution,
  };
  const outcomeType = outcomeTypeFor(action);
  const routeContext = buildRoute(need.agentId);
  const scoredOptions = approveDeferRejectScoredOptions(
    "Approve proposal",
    "Defer proposal",
    "Reject proposal",
  );
  const recommendedOptionId = await recommendOptionAgainstCommandments({
    db: prisma,
    scoredOptions,
  });

  await prisma.$transaction(async (tx) => {
    await tx.decisionInteraction.create({
      data: {
        interactionId: decisionInteractionId,
        profileId: MARK_DPF_PLATFORM_PROFILE.profileId,
        profileVersionId: MARK_DPF_PLATFORM_PROFILE.currentVersion.versionId,
        fallbackProfileId: null,
        triggeredByUserId: userId,
        routeContext,
        phaseFrom: null,
        phaseTo: null,
        domainClass: "risk-assessment",
        question: `Resolve Work Case proposal for Living Playbook "${need.need}"?`,
        options: ["Approve proposal", "Defer proposal", "Reject proposal"],
        scoredOptions,
        recommendedOptionId,
        chosenOptionId: action,
        evidenceBundle: inputJson({
          workPatternReview: reviewWithResolution,
          workPatternCaseProposalResolution: resolution,
          capabilityNeedId: need.needId,
          linkedBacklogItemId: need.linkedBacklogItemId ?? null,
          materialCount: 0,
          freshnessDistribution: { current: 0, stale: 0, superseded: 0, contradicted: 0 },
          resolvedProfileChain: [MARK_DPF_PLATFORM_PROFILE.profileId],
        }),
        sources: evidenceSources({ need, evidenceJson }),
        rationale: note ?? `Operator recorded ${action} for Work Case proposal ${staging.transitionId}.`,
        riskTier: riskTierFor(reviewState.riskClass),
        confidenceBefore: 0,
        confidenceAfter: 0,
        outcomeType,
        principleConflict: false,
        outcomePayload: inputJson({
          outcomeType,
          domainClass: "risk-assessment",
          confidenceScore: 0,
          coverageGap: resolution.receiptCoverage !== "covered",
          principleConflict: false,
          resolvedProfileChain: [MARK_DPF_PLATFORM_PROFILE.profileId],
          materialCount: 0,
          freshnessDistribution: { current: 0, stale: 0, superseded: 0, contradicted: 0 },
          workPatternCaseProposalResolution: resolution,
        }),
        humanOutcome: {
          type: "work-pattern-case-proposal-resolution",
          action,
          chosenOption:
            action === "approve"
              ? "Approve proposal"
              : action === "defer"
                ? "Defer proposal"
                : "Reject proposal",
          rationale: note,
          resolverUserId: userId,
          recordedAt: resolution.resolvedAt,
          clearsGate: false,
        },
      },
    });

    await tx.coworkerCapabilityNeed.update({
      where: { needId },
      data: {
        evidenceJson: inputJson({
          ...evidenceJson,
          caseProposalResolutionDecisionInteractionId: decisionInteractionId,
          caseProposalResolutionDecisionInteractionIds: appendString(
            appendString(
              evidenceJson.caseProposalResolutionDecisionInteractionIds,
              existingResolution?.decisionInteractionId ?? "",
            ),
            decisionInteractionId,
          ),
          decisionInteractionIds: appendString(evidenceJson.decisionInteractionIds, decisionInteractionId),
        }),
        readinessJson: inputJson(updatedReadiness),
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

export async function resolveWorkPatternCaseProposalAction(formData: FormData): Promise<void> {
  await resolveWorkPatternCaseProposal(formData);
}
