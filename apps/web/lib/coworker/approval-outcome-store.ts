import "server-only";
import { prisma } from "@dpf/db";
import { projectApprovalOutcome, withApprovalFailureEvidence, withApprovalRuntimeEvidence, type ApprovalOutcome, type ApprovalOutcomeRow } from "./approval-outcome";
import { labelOnBehalfDecision } from "./on-behalf-decision";
import type { ApprovedRequestRun } from "./approved-request-run-types";
import { parseInitiativeReviewBinding, type InitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { isRecord } from "@/lib/shared/coerce";
import { readApprovalActionEvidence, readApprovalFailureEvidence, type ApprovalActionEvidence, type RuntimeEvidenceRequest, type RuntimeTransitionObservation } from "./approval-action-evidence";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import { canonicalWorkCaseHref } from "@/lib/work-management/canonical-case-key";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/govern/permissions";
import { readFile } from "node:fs/promises";
import { MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";
import { canonicalTransitionPayload, prepareRuntimeReconciliationIntent, signTransitionPayload,
  validateRuntimeServiceImagePlan, verifyHistoricalTransitionReceipt,
  type RuntimeTransitionEnvelope, type RuntimeTransitionReceipt } from "@/lib/platform-runtime/transition-protocol";
import { computeCapabilityStateVersion } from "../../../../scripts/lib/capability-state-hash.mjs";

type Db = typeof prisma;

const select = {
  id: true, status: true, createdAt: true, expiresAt: true, argsJson: true,
  delegatingUserId: true, coworkerAgentId: true, threadId: true, manifestActionId: true, inputFingerprint: true,
  toolExecutions: {
    where: { executionMode: "approval-outcome" },
    orderBy: { createdAt: "desc" as const }, take: 1,
    select: { executionMode: true, success: true, result: true },
  },
} as const;

/** Audit the runner's result, including refusals before governed execution.
 * Distinct audit verb prevents this receipt from being replayed as a tool result.
 * This never changes the envelope's authority, expiry, or execution reservation. */
export async function recordApprovalOutcome(
  envelopeId: string, userId: string, outcome: ApprovedRequestRun, db: Db = prisma,
  /** BI-7BCC87BB: an admin who decided on `userId`'s behalf; the request stays `userId`'s. */
  decidedByUserId?: string,
): Promise<void> {
  const envelope = await db.coworkerActionEnvelope.findFirst({ where: { id: envelopeId, delegatingUserId: userId } });
  if (!envelope) throw new Error("Approval request not available.");
  await db.toolExecution.create({ data: {
    threadId: envelope.threadId, agentId: envelope.coworkerAgentId,
    userId: decidedByUserId ?? userId, delegatingUserId: userId, envelopeId, taskRunId: envelope.taskRunId,
    toolName: "approval_outcome", executionMode: "approval-outcome",
    parameters: {}, success: outcome.status === "executed",
    // Raw handler messages can contain private task data; the shared projection
    // supplies safe, actionable copy from the bounded status and refusal reason.
    result: { status: outcome.status, ...(outcome.status === "not-run" ? { reason: outcome.reason } : {}) },
  } });
}

/** Exact caller identity comes from the authenticated MCP context, never params. */
export async function readApprovalOutcome(
  envelopeId: string, userId: string, agentId: string | undefined, db: Db = prisma, now = new Date(),
): Promise<(ApprovalOutcome & { actionEvidence: ApprovalActionEvidence }) | null> {
  if (!userId || !agentId) return null;
  const row = await db.coworkerActionEnvelope.findFirst({
    where: { id: envelopeId, delegatingUserId: userId, coworkerAgentId: agentId },
    select,
  });
  if (!row) return null;
  const projected = await projectOwnedApprovalOutcome(row, db, now, agentId);
  return { ...projected, actionEvidence: projected.runtimeEvidence ?? await readApprovalActionEvidence(row, db, now) };
}

/** Recent history is separate from the actionable Inbox and never inflates its count.
 * An exact deep link may read older requests, with the same owner predicate. */
export async function loadApprovalOutcomes(
  userId: string, envelopeId?: string, db: Db = prisma, now = new Date(),
): Promise<ApprovalOutcome[]> {
  if (!userId) return [];
  const rows = await db.coworkerActionEnvelope.findMany({
    where: {
      delegatingUserId: userId,
      ...(envelopeId ? { id: envelopeId } : {
        createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
        OR: [{ status: { not: "proposed" } }, { expiresAt: { lte: now } }],
      }),
    },
    orderBy: { createdAt: "desc" }, take: envelopeId ? 1 : 10, select,
  });
  const outcomes = await Promise.all(rows.map((row) => projectOwnedApprovalOutcome(row, db, now)));
  return labelOnBehalfOutcomes(outcomes, db);
}

/** Same safe projection for owner history/API and caller-scoped MCP. */
async function projectOwnedApprovalOutcome(
  row: ApprovalOutcomeRow & { delegatingUserId: string; coworkerAgentId: string; threadId: string;
    manifestActionId: string; inputFingerprint: string | null; argsJson: unknown },
  db: Db, now: Date, agentId?: string,
): Promise<ApprovalOutcome> {
  const outcome = projectApprovalOutcome(row, now);
  if (row.manifestActionId === "reconcile_runtime_capabilities") {
    if (row.status !== "executed" && row.status !== "failed") return outcome;
    const evidence = await readApprovalActionEvidence(row, db, now, request => readOwnedRuntimeTransition(request, db, now));
    return withApprovalRuntimeEvidence(outcome, evidence.state !== "available" || evidence.toolName === "reconcile_runtime_capabilities"
      ? evidence : { state: "missing", reason: "result-unproven" });
  }
  if (outcome.state !== "failed") return outcome;
  const evidence = await readApprovalFailureEvidence(row, db, now, async capsuleId => {
    const room = await db.workroom.findUnique({ where: { capsuleId }, select: { id: true, capsuleId: true } });
    if (!room) return null;
    const access = await import("@/lib/work-management/workroom-agent-access.server");
    const input = { userId: row.delegatingUserId, workroomId: room.id, requested: "content" as const };
    const result = agentId ? await access.resolveAgentWorkroomAccess({ ...input, agentId }, db)
      : await access.resolveHumanWorkroomAccess(input, db);
    if (result.decision.level !== "content" && result.decision.level !== "action") return null;
    return canonicalWorkCaseHref(encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: room.capsuleId }), {});
  });
  return withApprovalFailureEvidence(outcome, evidence);
}

/** Only the already qualified original operation reaches this exact read.
 * Never run the executor/reconciler or substitute current host/latest history. */
async function readOwnedRuntimeTransition(request: RuntimeEvidenceRequest, db: Db, now: Date): Promise<RuntimeTransitionObservation> {
  const unproven = { receiptVerification: "unproven" as const };
  const user = await currentUserContext(request.requestedById, db);
  if (!user || !can(user, "manage_platform")) return { state: "unavailable", ...unproven };
  const row = await db.runtimeCapabilityTransition.findUnique({
    where: { transitionId: request.transitionId, requestedById: request.requestedById },
    select: { transitionId: true, requestedById: true, status: true, createdAt: true, completedAt: true,
      previousStates: true, desiredStates: true, catalogHash: true, previousStateHash: true, desiredStateHash: true,
      envelope: true, envelopeSignature: true, hostReceipt: true, failure: true },
  });
  if (!row) return { state: "not-recorded", ...unproven };
  const states = ["pending", "applying", "host_applied", "succeeded", "failed", "compensating", "rolled_back", "rollback_failed"] as const;
  let envelope: RuntimeTransitionEnvelope;
  try {
    if (JSON.stringify(row).length > MCP_ROUTE_TOOL_RESULT_CHAR_CAP) return { state: "unavailable", ...unproven };
    if (row.transitionId !== request.transitionId || row.requestedById !== request.requestedById
      || !Number.isFinite(row.createdAt.getTime()) || row.createdAt < request.executedAt || row.createdAt > now
      || !states.includes(row.status as typeof states[number]) || !isRecord(row.envelope)
      || !isRecord(row.previousStates) || !isRecord(row.desiredStates)) throw new Error();
    envelope = row.envelope as unknown as RuntimeTransitionEnvelope;
    if ((envelope.version !== 2 && envelope.version !== 3) || envelope.mode !== "reconciliation"
      || envelope.transitionId !== request.transitionId || envelope.catalogHash !== row.catalogHash
      || envelope.previousStateHash !== row.previousStateHash || envelope.desiredStateHash !== row.desiredStateHash) throw new Error();
    const prepared = prepareRuntimeReconciliationIntent(request.reconciliation as never,
      { catalogHash: row.catalogHash, capabilityIds: Object.keys(row.previousStates) });
    const same = (a: unknown, b: unknown) => canonicalTransitionPayload(a) === canonicalTransitionPayload(b);
    if (!same(prepared, envelope.reconciliation) || !same(prepared.observedDatabaseStates, row.previousStates)
      || !same(prepared.desiredDatabaseStates, row.desiredStates)
      || !same([...prepared.observedHost.enabledRuntimeCapabilities].sort(), envelope.previousKeys)
      || !same([...prepared.desiredHostEnabledKeys].sort(), envelope.desiredKeys)
      || envelope.previousStateHash !== prepared.observedHost.capabilityStateVersion
      || envelope.desiredStateHash !== computeCapabilityStateVersion(row.catalogHash, prepared.desiredHostEnabledKeys, Object.keys(row.previousStates))) throw new Error();
    if (request.imageServices === undefined) { if (envelope.version !== 2) throw new Error(); }
    else {
      if (envelope.version !== 3 || !Array.isArray(request.imageServices)
        || request.imageServices.length !== 1 || request.imageServices[0] !== "browser-use") throw new Error();
      validateRuntimeServiceImagePlan(envelope);
      if (envelope.imagePlan.operation !== "prepare" || !same(request.imageServices, envelope.imagePlan.services.map(item => item.service))) throw new Error();
    }
  } catch { return { state: "conflicting", ...unproven }; }
  let receiptStatus: RuntimeTransitionReceipt["status"] | null = null;
  if (row.hostReceipt) {
    try {
      const secret = (await readFile("/dpf-state/runtime-transition.secret", "utf8")).trim();
      if (typeof row.envelopeSignature !== "string" || row.envelopeSignature !== signTransitionPayload(envelope, secret)) throw new Error();
      const receipt = row.hostReceipt as unknown as RuntimeTransitionReceipt;
      const verified = verifyHistoricalTransitionReceipt(receipt, secret, envelope);
      if (!Number.isFinite(Date.parse(receipt.completedAt)) || Date.parse(receipt.completedAt) > now.getTime()
        || (row.status === "succeeded" && verified !== "applied")) throw new Error();
      receiptStatus = verified;
    } catch { /* Recorded state survives; missing or contradictory host proof does not. */ }
  }
  return { state: "recorded", status: row.status as typeof states[number],
    receiptVerification: receiptStatus ? "verified" : "unproven", receiptStatus,
    recoveryRequired: isRecord(row.failure) && row.failure.recoveryRequired === true ? "recorded" : "unproven" };
}

/** BI-7BCC87BB: name the admin and the owner of an on-behalf decision by email. */
async function labelOnBehalfOutcomes(outcomes: ApprovalOutcome[], db: Db): Promise<ApprovalOutcome[]> {
  const ids = [...new Set(outcomes.flatMap((o) => (o.decidedOnBehalf ? [o.decidedOnBehalf.by, o.decidedOnBehalf.onBehalfOf] : [])))];
  if (ids.length === 0) return outcomes;
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }).catch(() => []);
  const labels = new Map(users.map((user) => [user.id, user.email]));
  return outcomes.map((o) => (o.decidedOnBehalf ? { ...o, decidedOnBehalf: labelOnBehalfDecision(o.decidedOnBehalf, labels) } : o));
}

type ReviewLocator = Pick<InitiativeReviewBinding, "writerToolName" | "itemId" | "gate" | "artifactRef" | "workroomRef">;
type PendingApprovalOutcome = ApprovalOutcome & {
  delegatingUserId: string;
  coworkerAgentId: string;
  expiresAtIso: string | null;
  taskRunId: string | null;
  reviewBinding: ReviewLocator | null;
};

/** Discovery retains the exact reader's user AND assistant isolation. Metadata
 * is parsed and whitelisted; an evidence locator grants no source access. */
export async function listPendingApprovalOutcomes(
  userId: string, agentId: string | undefined, db: Db = prisma, now = new Date(),
): Promise<{ approvals: PendingApprovalOutcome[]; hasMore: boolean; inboxHref: string }> {
  if (!userId || !agentId) return { approvals: [], hasMore: false, inboxHref: "/workspace/inbox" };
  const pageSize = 20;
  const rows = await db.coworkerActionEnvelope.findMany({
    where: {
      delegatingUserId: userId, coworkerAgentId: agentId, status: "proposed",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: pageSize + 1,
    select: {
      ...select, delegatingUserId: true, coworkerAgentId: true, taskRunId: true,
      manifestActionId: true,
      taskRun: { select: { userId: true, a2aMetadata: true } },
    },
  });
  const approvals = rows.slice(0, pageSize).map((row): PendingApprovalOutcome => {
    const metadata = row.taskRun?.userId === userId && isRecord(row.taskRun.a2aMetadata)
      ? row.taskRun.a2aMetadata : null;
    const binding = parseInitiativeReviewBinding(metadata?.initiativeReviewBinding);
    const reviewBinding: ReviewLocator | null = binding?.writerToolName === row.manifestActionId
      ? {
        writerToolName: binding.writerToolName, itemId: binding.itemId,
        gate: binding.gate, artifactRef: binding.artifactRef,
        ...(binding.workroomRef ? { workroomRef: binding.workroomRef } : {}),
      } : null;
    return {
      ...projectApprovalOutcome(row, now), delegatingUserId: row.delegatingUserId,
      coworkerAgentId: row.coworkerAgentId, expiresAtIso: row.expiresAt?.toISOString() ?? null,
      taskRunId: row.taskRunId, reviewBinding,
    };
  });
  return { approvals, hasMore: rows.length > pageSize, inboxHref: "/workspace/inbox" };
}
