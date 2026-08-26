import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";

import { recordExternalEvidence } from "@/lib/actions/external-evidence";
import type { BuildSandboxState } from "@/lib/build/sandbox-state";
import { dispatchRoutedSemanticReview } from "./routed-semantic-review";
import {
  resolveSemanticReviewCoordination,
  runSemanticChangeReview,
  type SemanticChangeReviewMode,
  type SemanticChangeReviewOperationResult,
} from "./semantic-change-review-operation";
import {
  assessSemanticReviewReceiptFreshness,
  type SemanticReviewReceipt,
} from "./semantic-change-review";
import {
  claimSemanticReviewSingleFlight,
  completeSemanticReviewSingleFlight,
  createPrismaSemanticReviewSingleFlightStore,
  failSemanticReviewSingleFlight,
} from "./semantic-review-single-flight";
import { deriveSemanticReviewGateIdentity } from "@/lib/gates/gate-run-identity";
import { recordWorkCapsuleEvidence } from "@/lib/work-capsules/work-capsule-store";
import { gateRunDispositionsTotal } from "@/lib/operate/metrics";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const SEMANTIC_REVIEW_DISPATCH_CONTRACT_VERSION = "routed-semantic-review.v1";

export type BuildStudioSemanticReviewResult =
  | { kind: "reviewed"; outcome: SemanticChangeReviewOperationResult }
  | { kind: "unavailable"; reason: string; mayContinue: boolean };

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

/**
 * Run one assembled-change review after task-level review has completed and
 * before Build Studio begins UX verification or promotion.
 */
export async function reviewBuildStudioAssembledChange(args: {
  build: {
    id: string;
    buildId: string;
    title: string;
    createdById: string;
    diffPatch: string | null;
    verificationOut: unknown;
  };
  sandboxState: BuildSandboxState | null;
}): Promise<BuildStudioSemanticReviewResult> {
  const mode = reviewMode();
  const capsule = await prisma.workroom.findFirst({
    where: { featureBuildId: args.build.id, archivedAt: null },
    select: { id: true, capsuleId: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!capsule) {
    return { kind: "unavailable", reason: "Build Studio Work Capsule is missing.", mayContinue: mode === "shadow" };
  }

  const currency = args.sandboxState?.sourceCurrency;
  const diffPatch = args.build.diffPatch?.trim() ?? "";
  if (!currency?.headTreeSha || !currency.targetTreeSha || currency.dirty || !diffPatch) {
    return {
      kind: "unavailable",
      reason: "Assembled change does not yet have a clean committed base/head tree and exact diff.",
      mayContinue: mode === "shadow",
    };
  }

  const priorRows = await prisma.externalEvidenceRecord.findMany({
    where: { workCapsuleId: capsule.id, operationType: "semantic-change-review.receipt" },
    orderBy: { createdAt: "desc" },
    select: { id: true, details: true },
    take: 3,
  });
  const receipts: SemanticReviewReceipt[] = priorRows.flatMap(
    (row: { details: unknown }) => isReceipt(row.details) ? [row.details] : [],
  );
  const priorReceipt = receipts[0] ?? null;
  const repairRound = Math.min(
    receipts.findIndex((receipt) => receipt.result.decision !== "fail") === -1
      ? receipts.filter((receipt) => receipt.result.decision === "fail").length
      : receipts.findIndex((receipt) => receipt.result.decision !== "fail"),
    2,
  );
  const changedFiles = args.sandboxState?.sourceDiffstat.map((entry) => entry.path) ?? [];
  const operationInput: Parameters<typeof runSemanticChangeReview>[0] = {
    surface: "build-studio",
    authorSurface: "build-studio",
    artifactType: "code-change",
    title: args.build.title,
    artifact: diffPatch,
    verificationEvidence: JSON.stringify(args.build.verificationOut ?? {}, null, 2),
    changedFiles,
    identity: {
      capsuleId: capsule.capsuleId,
      baseTreeHash: currency.targetTreeSha,
      headTreeHash: currency.headTreeSha,
      diffDigest: createHash("sha256").update(diffPatch).digest("hex"),
      specialistIds: [],
    },
    priorReceipt,
    repairRound,
    mode,
  };
  const coordination = resolveSemanticReviewCoordination(operationInput);
  const { gateKey } = deriveSemanticReviewGateIdentity({
    repository: process.env.GITHUB_REPOSITORY
      ?? "OpenDigitalProductFactory/opendigitalproductfactory",
    identity: coordination.identity,
    risk: coordination.risk,
    dispatchContractVersion: SEMANTIC_REVIEW_DISPATCH_CONTRACT_VERSION,
  });
  const store = createPrismaSemanticReviewSingleFlightStore(prisma as never);
  const singleFlight = await claimSemanticReviewSingleFlight({
    gateKey,
    userId: args.build.createdById,
    capsuleId: capsule.capsuleId,
    title: `Semantic review: ${args.build.title}`,
    objective: `Independently review the immutable assembled change at ${currency.headTreeSha}.`,
  }, store, async (evidenceRecordId) => {
    const row = await prisma.externalEvidenceRecord.findUnique({
      where: { id: evidenceRecordId },
      select: { workCapsuleId: true, details: true },
    });
    return row?.workCapsuleId === capsule.id
      && isReceipt(row.details)
      && row.details.result.decision !== "inconclusive"
      && assessSemanticReviewReceiptFreshness(row.details, coordination.identity).fresh;
  });
  gateRunDispositionsTotal.inc({
    gate_kind: "semantic-review",
    disposition: singleFlight.disposition,
    result_class: singleFlight.disposition === "reused" ? singleFlight.resultClass : "none",
  });
  if (singleFlight.disposition === "subscribed") {
    return {
      kind: "unavailable",
      reason: `Canonical semantic review ${singleFlight.taskRunId} is already running.`,
      mayContinue: false,
    };
  }

  let coordinatedPriorReceipt = priorReceipt;
  let coordinatedEvidenceId = priorRows.find((row) => isReceipt(row.details))?.id ?? null;
  if (singleFlight.disposition === "reused") {
    const row = await prisma.externalEvidenceRecord.findUnique({
      where: { id: singleFlight.evidenceRecordId },
      select: { details: true },
    });
    if (!isReceipt(row?.details)) {
      throw new Error("Canonical semantic-review evidence is missing or invalid");
    }
    coordinatedPriorReceipt = row.details;
    coordinatedEvidenceId = singleFlight.evidenceRecordId;
  }

  let outcome: SemanticChangeReviewOperationResult;
  try {
    outcome = await runSemanticChangeReview({
      ...operationInput,
      priorReceipt: coordinatedPriorReceipt,
    }, { dispatch: dispatchRoutedSemanticReview });
  } catch (error) {
    await failSemanticReviewSingleFlight({
      taskRunId: singleFlight.taskRunId,
      reason: getErrorMessage(error),
    }, store);
    throw error;
  }

  if (outcome.reusedFreshReceipt && coordinatedEvidenceId) {
    if (singleFlight.disposition === "admitted") {
      await completeSemanticReviewSingleFlight({
        taskRunId: singleFlight.taskRunId,
        evidenceRecordId: coordinatedEvidenceId,
        resultClass: outcome.receipt.result.decision === "fail" ? "fail" : "pass",
      }, store);
    }
    return { kind: "reviewed", outcome };
  }

  const projection = outcome.evidence;
  const evidence = await recordExternalEvidence({
    actorUserId: args.build.createdById,
    routeContext: projection.externalEvidence.routeContext,
    operationType: projection.externalEvidence.operationType,
    target: projection.externalEvidence.target,
    provider: projection.externalEvidence.provider,
    resultSummary: projection.externalEvidence.resultSummary,
    details: projection.externalEvidence.details as unknown as Prisma.InputJsonValue,
    buildId: args.build.buildId,
    workCapsuleId: capsule.id,
    executorKind: "build-studio",
    recordedByAgentId: "change-reviewer",
  });
  await recordWorkCapsuleEvidence({
    db: prisma,
    capsuleId: capsule.capsuleId,
    evidence: {
      kind: "verification",
      summary: projection.activity.summary,
      targetId: evidence.id,
      result: projection.activity.payload,
    },
    actor: { userId: args.build.createdById, agentId: "change-reviewer", principalId: null },
  });
  if (outcome.receipt.result.decision === "inconclusive") {
    await failSemanticReviewSingleFlight({
      taskRunId: singleFlight.taskRunId,
      reason: outcome.receipt.result.inconclusiveReason ?? "semantic-review-inconclusive",
    }, store);
  } else {
    await completeSemanticReviewSingleFlight({
      taskRunId: singleFlight.taskRunId,
      evidenceRecordId: evidence.id,
      resultClass: outcome.receipt.result.decision === "fail" ? "fail" : "pass",
    }, store);
  }

  return { kind: "reviewed", outcome };
}
