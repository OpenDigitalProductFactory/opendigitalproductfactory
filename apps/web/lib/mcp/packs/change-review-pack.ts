import { prisma, type Prisma } from "@dpf/db";

import { recordExternalEvidence } from "@/lib/actions/external-evidence";
import { enqueueSemanticReview } from "@/lib/change-review/semantic-review-background";
import { createSemanticReviewRequest, REVIEW_ARTIFACT_TYPES, REVIEW_RISKS, REVIEW_PROFILES } from "@/lib/change-review/semantic-review-request";
import {
  runSemanticChangeReview,
  resolveSemanticReviewCoordination,
  type SemanticChangeReviewMode,
} from "@/lib/change-review/semantic-change-review-operation";
import {
  assessSemanticReviewReceiptFreshness,
  type SemanticReviewReceipt,
  type SemanticReviewRisk,
} from "@/lib/change-review/semantic-change-review";
import {
  claimSemanticReviewSingleFlight,
  createPrismaSemanticReviewSingleFlightStore,
  type SemanticReviewSingleFlightClaim,
} from "@/lib/change-review/semantic-review-single-flight";
import {
  SEMANTIC_REVIEW_OUTCOME_SCHEMA_VERSION,
  projectSemanticReviewOutcome,
  type SemanticReviewOutcome,
} from "@/lib/change-review/semantic-review-enforcement";
import type { DeliberationArtifactType, StrategyProfile } from "@/lib/deliberation/external-review-activation";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { recordWorkCapsuleEvidence } from "@/lib/work-capsules/work-capsule-store";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { gateRunDispositionsTotal } from "@/lib/operate/metrics";

const ARTIFACT_TYPES = [...REVIEW_ARTIFACT_TYPES];
const RISKS = [...REVIEW_RISKS];
const PROFILES = [...REVIEW_PROFILES];

const definitions: ToolDefinition[] = [{
  name: "review_semantic_change",
  description:
    "Independently review an immutable committed change before its first publication, record one fresh semantic-review receipt on the Work Capsule, and return whether the author should publish, repair, or escalate. " +
    "Call ONCE per committed (baseTreeHash, headTreeHash, diffDigest) identity — not as a status poll. " +
    "New reviews are persisted and queued before this call returns. Use MCP tasks/get and tasks/result with the returned taskRunId for progress and evidence. " +
    "After a publish/repair/escalate decision, do not re-call until the tree digests change. repairRound > 2 escalates instead of looping.",
  inputSchema: {
    type: "object",
    properties: {
      capsuleId: { type: "string", description: "WC-* Work Capsule governing this change" },
      authorSurface: { type: "string", description: "Authoring surface, for example codex-desktop, claude-desktop, or grok-desktop" },
      artifactType: { type: "string", enum: ARTIFACT_TYPES },
      title: { type: "string", description: "Human-readable committed change title" },
      artifact: { type: "string", description: "Exact committed diff or equivalent immutable assembled-change artifact" },
      verificationEvidence: { type: "string", description: "Tests, typecheck, build, migration, or scoped verification evidence available before publication" },
      changedFiles: { type: "array", items: { type: "string" } },
      baseTreeHash: { type: "string", description: "Git base tree hash for the committed review identity" },
      headTreeHash: { type: "string", description: "Git head tree hash for the committed review identity" },
      diffDigest: { type: "string", description: "Deterministic digest of the exact reviewed diff" },
      repairRound: { type: "number", description: "Zero-based repair round; after two failed repairs the operation escalates instead of looping" },
      risk: { type: "string", enum: RISKS },
      sensitivityFloor: { type: "string", enum: PROFILES },
    },
    required: [
      "capsuleId",
      "authorSurface",
      "artifactType",
      "title",
      "artifact",
      "verificationEvidence",
      "changedFiles",
      "baseTreeHash",
      "headTreeHash",
      "diffDigest",
    ],
  },
  requiredCapability: "view_platform",
  executionMode: "immediate",
  sideEffect: true,
  buildPhases: ["build", "review", "ship"],
}, {
  name: "record_semantic_review_outcome",
  description:
    "Correlate one persisted semantic-review receipt with its terminal GitHub/CI outcome, recording measured quality telemetry while excluding infrastructure-inconclusive samples from precision and unique-yield denominators.",
  inputSchema: {
    type: "object",
    properties: {
      capsuleId: { type: "string" },
      receiptId: { type: "string", description: "ExternalEvidenceRecord id for semantic-change-review.receipt" },
      surface: { type: "string", enum: ["external", "build-studio"] },
      pullRequestNumber: { type: "number" },
      ciPassed: { type: "boolean" },
      merged: { type: "boolean" },
      acceptedFindingCount: { type: "number" },
      falsePositiveFindingCount: { type: "number" },
      uniqueLocalFindingCount: { type: "number" },
      postPublicationMissCount: { type: "number" },
      correctivePushCount: { type: "number" },
      timeToFirstSignalMs: { type: "number" },
      costUsd: { type: "number" },
    },
    required: ["capsuleId", "receiptId", "surface", "pullRequestNumber", "ciPassed", "merged"],
  },
  requiredCapability: "view_platform",
  executionMode: "immediate",
  sideEffect: true,
  buildPhases: ["review", "ship"],
}];

function stringParam(params: Record<string, unknown>, key: string): string {
  return typeof params[key] === "string" ? String(params[key]).trim() : "";
}

function reviewMode(): SemanticChangeReviewMode {
  return process.env.DPF_SEMANTIC_CHANGE_REVIEW_MODE === "enforce" ? "enforce" : "shadow";
}

function isReceipt(value: unknown): value is SemanticReviewReceipt {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { schemaVersion?: unknown }).schemaVersion === "semantic-change-review-receipt.v2",
  );
}

const reviewSemanticChange: ToolPackHandler = async (params, userId, context): Promise<ToolResult> => {
  const capsuleId = stringParam(params, "capsuleId");
  const authorSurface = stringParam(params, "authorSurface");
  const artifactType = stringParam(params, "artifactType") as DeliberationArtifactType;
  const title = stringParam(params, "title");
  const artifact = typeof params.artifact === "string" ? params.artifact : "";
  const verificationEvidence = stringParam(params, "verificationEvidence");
  const baseTreeHash = stringParam(params, "baseTreeHash");
  const headTreeHash = stringParam(params, "headTreeHash");
  const diffDigest = stringParam(params, "diffDigest");
  const changedFiles = Array.isArray(params.changedFiles)
    ? params.changedFiles.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  if (
    !capsuleId || !authorSurface || !ARTIFACT_TYPES.includes(artifactType) || !title || !artifact ||
    !verificationEvidence || changedFiles.length === 0 || !baseTreeHash || !headTreeHash || !diffDigest
  ) {
    return {
      success: false,
      error: "invalid_input",
      message: "A Work Capsule, committed tree identity, exact artifact, changed files, and verification evidence are required.",
    };
  }

  const capsule = await prisma.workroom.findUnique({
    where: { capsuleId },
    select: { id: true },
  });
  if (!capsule) {
    return { success: false, error: "capsule_not_found", message: `Work Capsule ${capsuleId} was not found.` };
  }

  const previousEvidence = await prisma.externalEvidenceRecord.findFirst({
    where: { workCapsuleId: capsule.id, operationType: "semantic-change-review.receipt" },
    orderBy: { createdAt: "desc" },
    select: { id: true, details: true },
  });
  const priorReceipt = isReceipt(previousEvidence?.details) ? previousEvidence.details : null;
  const risk = RISKS.includes(params.risk as SemanticReviewRisk) ? params.risk as SemanticReviewRisk : undefined;
  const sensitivityFloor = PROFILES.includes(params.sensitivityFloor as StrategyProfile)
    ? params.sensitivityFloor as StrategyProfile
    : undefined;
  const operationInput: Parameters<typeof runSemanticChangeReview>[0] = {
    surface: "external",
    authorSurface,
    artifactType,
    title,
    artifact,
    verificationEvidence,
    changedFiles,
    identity: {
      capsuleId,
      baseTreeHash,
      headTreeHash,
      diffDigest,
      specialistIds: [],
    },
    priorReceipt,
    repairRound: typeof params.repairRound === "number" ? params.repairRound : 0,
    risk,
    sensitivityFloor,
    mode: reviewMode(),
  };
  let singleFlight: SemanticReviewSingleFlightClaim | null = null;

  try {
    const coordination = resolveSemanticReviewCoordination(operationInput);
    const packet = createSemanticReviewRequest(operationInput, {
      userId, agentId: context?.agentId ?? null, apiTokenId: context?.apiTokenId ?? null,
      authSource: context?.authSource ?? null,
    });
    const { gateKey } = packet;
    const store = createPrismaSemanticReviewSingleFlightStore(prisma as never, { packet });
    singleFlight = await claimSemanticReviewSingleFlight({
      gateKey,
      userId,
      capsuleId,
      title: `Semantic review: ${title}`,
      objective: `Independently review the immutable change at ${headTreeHash}.`,
    }, store, async (evidenceRecordId) => {
      const row = await prisma.externalEvidenceRecord.findUnique({
        where: { id: evidenceRecordId },
        select: { workCapsuleId: true, details: true },
      });
      if (row?.workCapsuleId !== capsule.id || !isReceipt(row.details)) return false;
      return row.details.result.decision !== "inconclusive"
        && assessSemanticReviewReceiptFreshness(row.details, coordination.identity).fresh;
    });
    gateRunDispositionsTotal.inc({
      gate_kind: "semantic-review",
      disposition: singleFlight.disposition,
      result_class: singleFlight.disposition === "reused" ? singleFlight.resultClass : "none",
    });

    if (singleFlight.disposition === "admitted") {
      const queued = await enqueueSemanticReview(singleFlight.taskRunId);
      return { success: true, entityId: singleFlight.taskRunId,
        message: `Semantic review ${singleFlight.taskRunId} persisted; ${queued ? "queued for execution" : "dispatch reconciliation pending"}.`,
        data: { disposition: "admitted", gateKey, taskRunId: singleFlight.taskRunId,
          attempt: singleFlight.attempt, queued, deadlineAt: packet.deadlineAt },
      };
    }

    if (singleFlight.disposition === "subscribed") {
      return {
        success: true,
        entityId: singleFlight.taskRunId,
        message: `Subscribed to canonical semantic review ${singleFlight.taskRunId}.`,
        data: {
          disposition: "subscribed",
          gateKey,
          taskRunId: singleFlight.taskRunId,
          attempt: singleFlight.attempt,
        },
      };
    }

    const existing = await prisma.externalEvidenceRecord.findUnique({
      where: { id: singleFlight.evidenceRecordId }, select: { details: true },
    });
    if (!isReceipt(existing?.details)) throw new Error("Canonical semantic-review evidence is missing or invalid");
    const outcome = await runSemanticChangeReview({ ...operationInput, priorReceipt: existing.details }, {
      dispatch: async () => { throw new Error("Canonical semantic-review evidence is no longer fresh"); },
    });
    return { success: true, entityId: singleFlight.evidenceRecordId,
      message: `Reused the fresh semantic review receipt for ${capsuleId}.`,
      data: { disposition: "reused", gateKey, taskRunId: singleFlight.taskRunId,
        receipt: outcome.receipt, fresh: true, reusedFreshReceipt: true, staleReasons: outcome.staleReasons,
        mayPublish: outcome.mayPublish, nextAction: outcome.nextAction,
        repairLimitReached: outcome.repairLimitReached, mode: reviewMode() },
    };
  } catch (error) {
    if (singleFlight?.disposition === "admitted") {
      return { success: true, entityId: singleFlight.taskRunId,
        message: "The immutable review is persisted; background dispatch reconciliation will continue.",
        data: { disposition: "admitted", taskRunId: singleFlight.taskRunId, queued: false },
      };
    }
    return { success: false, error: "review_failed", message: getErrorMessage(error) };
  }
};

function nonNegativeNumber(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

const recordSemanticReviewOutcome: ToolPackHandler = async (params, userId, context): Promise<ToolResult> => {
  const capsuleId = stringParam(params, "capsuleId");
  const receiptId = stringParam(params, "receiptId");
  const surface = params.surface === "build-studio" ? "build-studio" : params.surface === "external" ? "external" : null;
  const pullRequestNumber = nonNegativeNumber(params, "pullRequestNumber");
  if (!capsuleId || !receiptId || !surface || !Number.isInteger(pullRequestNumber) || pullRequestNumber <= 0 ||
    typeof params.ciPassed !== "boolean" || typeof params.merged !== "boolean") {
    return { success: false, error: "invalid_input", message: "Capsule, receipt, surface, PR number, and terminal GitHub/CI state are required." };
  }
  const capsule = await prisma.workroom.findUnique({ where: { capsuleId }, select: { id: true } });
  if (!capsule) return { success: false, error: "capsule_not_found", message: `Work Capsule ${capsuleId} was not found.` };
  const receiptRow = await prisma.externalEvidenceRecord.findFirst({
    where: { id: receiptId, workCapsuleId: capsule.id, operationType: "semantic-change-review.receipt" },
    select: { details: true, createdAt: true },
  });
  if (!isReceipt(receiptRow?.details)) {
    return { success: false, error: "receipt_not_found", message: `A current semantic-review receipt ${receiptId} was not found on ${capsuleId}.` };
  }
  const priorOutcome = await prisma.externalEvidenceRecord.findFirst({
    where: {
      workCapsuleId: capsule.id,
      operationType: "semantic-change-review.outcome",
      target: receiptId,
    },
    select: { id: true, resultSummary: true, details: true },
  });
  if (priorOutcome) {
    return {
      success: true,
      entityId: priorOutcome.id,
      message: priorOutcome.resultSummary,
      data: { outcome: priorOutcome.details, reused: true },
    };
  }
  const receipt = receiptRow.details;
  const correlationStatus = receipt.result.decision === "inconclusive"
    ? "infrastructure-inconclusive" as const
    : "completed" as const;
  const outcome: SemanticReviewOutcome = {
    schemaVersion: SEMANTIC_REVIEW_OUTCOME_SCHEMA_VERSION,
    receiptId,
    capsuleId,
    surface,
    reviewDisposition: receipt.disposition,
    reviewDecision: receipt.result.decision,
    correlationStatus,
    acceptedFindingCount: correlationStatus === "completed" ? nonNegativeNumber(params, "acceptedFindingCount") : 0,
    falsePositiveFindingCount: correlationStatus === "completed" ? nonNegativeNumber(params, "falsePositiveFindingCount") : 0,
    uniqueLocalFindingCount: correlationStatus === "completed" ? nonNegativeNumber(params, "uniqueLocalFindingCount") : 0,
    postPublicationMissCount: correlationStatus === "completed" ? nonNegativeNumber(params, "postPublicationMissCount") : 0,
    correctivePushCount: correlationStatus === "completed" ? nonNegativeNumber(params, "correctivePushCount") : 0,
    timeToFirstSignalMs: correlationStatus === "completed" && typeof params.timeToFirstSignalMs === "number"
      ? nonNegativeNumber(params, "timeToFirstSignalMs")
      : null,
    costUsd: correlationStatus === "completed" && typeof params.costUsd === "number" ? nonNegativeNumber(params, "costUsd") : null,
    github: { pullRequestNumber, ciPassed: params.ciPassed, merged: params.merged },
    recordedAt: new Date().toISOString(),
  };
  const projection = projectSemanticReviewOutcome(outcome);
  const evidence = await recordExternalEvidence({
    actorUserId: userId,
    routeContext: projection.externalEvidence.routeContext,
    operationType: projection.externalEvidence.operationType,
    target: projection.externalEvidence.target,
    provider: projection.externalEvidence.provider,
    resultSummary: projection.externalEvidence.resultSummary,
    details: projection.externalEvidence.details as unknown as Prisma.InputJsonValue,
    workCapsuleId: capsule.id,
    executorKind: context?.agentId ?? surface,
    recordedByAgentId: context?.agentId,
  });
  await recordWorkCapsuleEvidence({
    db: prisma,
    capsuleId,
    evidence: { kind: "verification", summary: projection.activity.summary, targetId: evidence.id, result: projection.activity.payload },
    actor: { userId, agentId: context?.agentId ?? null, principalId: null },
  });
  return { success: true, entityId: evidence.id, message: projection.activity.summary, data: { outcome } };
};

export const changeReviewPack: ToolPack = {
  packId: "change-review",
  definitions,
  handlers: {
    review_semantic_change: reviewSemanticChange,
    record_semantic_review_outcome: recordSemanticReviewOutcome,
  },
  grants: {
    review_semantic_change: ["backlog_write"],
    record_semantic_review_outcome: ["backlog_write"],
  },
};
