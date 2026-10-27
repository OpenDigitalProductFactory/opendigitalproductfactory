import type { BoundedHandoffRequest } from "./bounded-handoff-command";
import type { InitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { projectRecordedTaskState } from "@/lib/tak/task-states";
import type { loadSemanticReviewRoomProjection } from "@/lib/work-management/semantic-review-room-projection";
import { isFullSourceCommitSha } from "./work-capsule-branch-identity";
import { isRecord } from "@/lib/shared/coerce";

export const RECORDED_BLOCKER_REASON_MAX_BYTES = 2048;
type RecordedBlockerRoom = { capsuleId?: string; status?: string | null; workspaceState?: unknown };

/** Reported coordination explains a hold; it never supplies authority or a repair action. */
export function projectRecordedWorkroomBlocker(room: RecordedBlockerRoom, now = new Date()) {
  if (room.status !== "blocked" && room.status !== "provider-blocked") return null;
  const workspace = isRecord(room.workspaceState) ? room.workspaceState : null;
  const override = workspace && isRecord(workspace.statusOverride) ? workspace.statusOverride : null;
  const until = typeof override?.until === "string" ? override.until : null;
  const expiry = until ? Date.parse(until) : NaN;
  const validExpiry = Number.isFinite(expiry) && new Date(expiry).toISOString() === until;
  const reason = typeof override?.reason === "string" ? override.reason.trim() : null;
  const nowMs = now.getTime();
  const explanationState = !validExpiry || !Number.isFinite(nowMs) ? "unavailable" as const
    : expiry <= nowMs ? "expired" as const
      : !reason ? "unavailable" as const
        : Buffer.byteLength(reason, "utf8") > RECORDED_BLOCKER_REASON_MAX_BYTES ? "over-budget" as const
          : "current" as const;
  return {
    reason: "workroom-blocked" as const,
    explanation: explanationState === "current" ? reason : null,
    explanationState,
    expiresAt: validExpiry ? until : null,
    source: { kind: "workroom-status-override" as const, capsuleId: room.capsuleId ?? null },
    coordinationOnly: true as const,
  };
}

export type FailedHandoffRecovery = {
  kind: "failed-bounded-handoff"; state: "ready" | "waiting" | "blocked" | "resolved" | "unavailable"; reason: string; checkedAt: string;
  owner: { userId: string; agentId: string; executorRef: string } | null;
  original: { envelopeId: string; executionId: string; executedAt: string } | null;
  action: { toolName: "reassign_workroom_executor"; args: BoundedHandoffRequest; requiresExecutionRecheck: true; requiresReceiverAcknowledgement: true } | null;
  staleRequest?: { requestId: string; reason: string };
  pending?: { requestId: string; requestDigest: string; receiverRef: string };
  resolution?: { requestId: string; activityId: string; recordedAt: string };
};
export type RecordedWorkroomBlocker = NonNullable<ReturnType<typeof projectRecordedWorkroomBlocker>> | null;
export type WorkroomBlockerContentAuthorizer = (workroomRowId: string) => Promise<boolean>;

export type WorkroomHandoffRecoveryLoader = (workroomRowId: string, now: Date) => Promise<FailedHandoffRecovery | null>;

/** Authorize the exact selected room before reading either private history source. */
export async function loadContentAuthorizedWorkroomRecovery(
  room: (RecordedBlockerRoom & { id?: string }) | null | undefined, now: Date,
  canRead?: WorkroomBlockerContentAuthorizer, loadRecovery?: WorkroomHandoffRecoveryLoader,
): Promise<{ recordedBlocker: RecordedWorkroomBlocker; failedHandoffRecovery: FailedHandoffRecovery | null }> {
  const withheld = { recordedBlocker: null, failedHandoffRecovery: null };
  if (!room?.id?.trim() || !canRead || ["complete", "archived", "abandoned", "superseded"].includes(room.status ?? "")) return withheld;
  if (!loadRecovery && room.status !== "blocked" && room.status !== "provider-blocked") return withheld;
  try { if (await canRead(room.id) !== true) return withheld; } catch { return withheld; }
  let failedHandoffRecovery: FailedHandoffRecovery | null = null;
  try { failedHandoffRecovery = await loadRecovery?.(room.id, now) ?? null; }
  catch { failedHandoffRecovery = { kind: "failed-bounded-handoff", state: "unavailable", reason: "handoff-history-unavailable", checkedAt: now.toISOString(), owner: null, original: null, action: null }; }
  return { recordedBlocker: projectRecordedWorkroomBlocker(room, now), failedHandoffRecovery };
}

/** Compatibility for callers that only need the recorded explanation. */
export async function loadContentAuthorizedWorkroomBlocker(
  room: (RecordedBlockerRoom & { id?: string }) | null | undefined, now: Date,
  canRead?: WorkroomBlockerContentAuthorizer,
): Promise<RecordedWorkroomBlocker> {
  return (await loadContentAuthorizedWorkroomRecovery(room, now, canRead)).recordedBlocker;
}

type WorkroomIdentity = {
  capsuleId?: string;
  repositoryFullName: string | null;
  headBranch: string | null;
  worktreePath: string | null;
  baseSha: string | null;
  headSha: string | null;
  backlogItemId?: string | null;
  leaseHolderPrincipalId?: string | null;
};

type ReviewProjection = Pick<Awaited<ReturnType<typeof loadSemanticReviewRoomProjection>>, "runs" | "partial" | "attentionReason">
  & { partialCapsuleIds?: readonly string[] };

type WorkroomReadback = { capsule: Record<string, unknown>; log?: { afterSequence: number; activity: unknown[]; hasMore: boolean } };

const semanticBacklogId = (value: string | null | undefined): boolean => Boolean(value && /^BI-[a-z0-9-]+$/i.test(value));
type RecoveryItemDb = { backlogItem?: { findMany(args: unknown): Promise<Array<{ id?: string; itemId: string }>> } };

/** Legacy Build Studio rooms use row IDs; MCP recovery accepts semantic IDs.
 * Resolve only identifiers in one page-sized batch, never private item bodies. */
export async function loadWorkroomRecoveryItems(db: RecoveryItemDb, rooms: readonly Pick<WorkroomIdentity, "backlogItemId">[]) {
  const ids = [...new Set(rooms.flatMap(room => room.backlogItemId ? [room.backlogItemId] : []))];
  const result = new Map(ids.filter(semanticBacklogId).map(id => [id, id]));
  const rawIds = ids.filter(id => !semanticBacklogId(id));
  const rows = rawIds.length && db.backlogItem ? await db.backlogItem.findMany({
    where: { id: { in: rawIds } }, select: { id: true, itemId: true }, take: rawIds.length,
  }).catch(() => []) : [];
  for (const row of rows) if (row.id && rawIds.includes(row.id) && semanticBacklogId(row.itemId)) result.set(row.id, row.itemId);
  return result;
}

/** Preserve actionable facts instead of letting the route replace the whole room with a text preview. */
export function boundWorkroomRecoveryReadback(data: WorkroomReadback, fits: (value: unknown) => boolean) {
  if (fits(data)) return data;
  const retainedKeys = ["id", "capsuleId", "status", "backlogItemId", "repositoryFullName", "baseBranch", "baseSha",
    "headBranch", "headSha", "worktreePath", "executorKind", "executorRef", "leaseHolderPrincipalId", "leaseExpiresAt",
    "updatedAt", "createdByPrincipalId", "requestedByPrincipalId", "activitySequence", "taskRunId", "featureBuildId",
    "pullRequestUrl", "pullRequestNumber", "recovery", "investment"];
  const capsule = Object.fromEntries(retainedKeys.filter(key => key in data.capsule).map(key => [key, data.capsule[key]]));
  const omittedFields = Object.keys(data.capsule).filter(key => !retainedKeys.includes(key)).map(key => `capsule.${key}`);
  const compact = { ...data, capsule, omittedFields,
    activityRead: { toolName: "get_workroom", args: { capsuleId: data.capsule.capsuleId, afterSequence: 0 } } };
  if (fits(compact)) return compact;
  // Never consume a log cursor for rows the caller did not receive. Large raw
  // activity detail remains a separate bounded-detail repair (BI-3CE72645).
  const bounded = { ...compact, ...(data.log ? { log: { afterSequence: data.log.afterSequence, activity: [],
    hasMore: data.log.hasMore || data.log.activity.length > 0, incomplete: true,
    reason: "activity-page-budget-exceeded", nextAction: "Do not advance this cursor; bounded activity-detail recovery is required (BI-3CE72645)." } } : {}),
    omittedFields: [...omittedFields, ...(data.log ? ["log.activity"] : [])] };
  return fits(bounded) ? bounded : null;
}

const REVIEW_EXECUTION_LIMIT = 20;
const inspectOriginal = "Inspect this original request.";

/** One observed execution shape for current and explicitly historical facts. */
function projectReviewExecution(run: ReviewProjection["runs"][number], nextAction = run.nextAction) {
  const recorded = projectRecordedTaskState(run.status);
  const ordinary = run.reviewKind === "initiative-review";
  const receipt = run.status === "completed" || (run.status === "input-required" && run.receipt?.decision === "inconclusive")
    ? run.receipt : null;
  const requestDigest = ordinary && /^[a-f0-9]{64}$/i.test(run.requestDigest ?? "") ? run.requestDigest : null;
  return {
    taskRunId: run.taskRunId, status: run.status, identityScope: run.identityScope,
    reviewKind: run.reviewKind ?? "semantic-review", reviewGate: run.reviewGate ?? null,
    artifactVersion: run.artifactVersion ?? null, requestDigest,
    executionUncertain: run.executionUncertain ?? false, identityConflict: run.identityConflict ?? false,
    sourceHeadSha: run.sourceHeadSha ?? null,
    pending: recorded === "unknown" ? null : recorded !== "terminal",
    accountableOwner: { agentId: run.requesterAgentId ?? null, userId: run.requesterId, displayName: run.requesterName ?? null },
    reason: run.reason, nextAction: ordinary ? inspectOriginal : nextAction,
    resultAction: run.requesterId ? { method: "tasks/result" as const,
      params: { taskId: run.taskRunId, ...(requestDigest ? { requestDigest } : {}) }, requiredUserId: run.requesterId } : null,
    heartbeat: run.heartbeat, lastHeartbeatAt: run.lastHeartbeatAt, readAt: run.readAt,
    budget: ordinary ? { deadlineAt: null, recoveryAttempt: null } : run.budget, receipt: receipt ?? null,
  };
}

function reviewExecutionState(run: ReviewProjection["runs"][number]) {
  const execution = projectReviewExecution(run);
  const recorded = projectRecordedTaskState(run.status);
  // Prior generation receipts cannot replace a resumed generation's state.
  const reason = run.executionUncertain ? "review-execution-uncertain"
    : execution.receipt?.decision === "fail" ? "review-failed"
      : execution.receipt?.decision === "inconclusive" ? run.reason ?? "review-inconclusive"
        : recorded === "terminal" && !execution.receipt ? "review-receipt-unavailable"
          : recorded === "waiting" || recorded === "unknown" ? run.reason ?? ("review-" + recorded) : null;
  const state = run.executionUncertain || reason === "review-receipt-unavailable" ? "unknown" as const
    : execution.receipt?.decision === "fail" ? "blocked" as const
      : execution.receipt?.decision === "inconclusive" ? "waiting" as const : recorded;
  return { execution, state, reason };
}

/** Observations are readback, never completion evidence or retry authorization. */
function projectSemanticRecovery(room: WorkroomIdentity, view: ReviewProjection, recoveryItemId: string | null) {
  const runs = view.runs.filter(run => run.capsuleId === room.capsuleId);
  const partial = view.partialCapsuleIds && room.capsuleId
    ? view.partialCapsuleIds.includes(room.capsuleId) : view.partial;
  if (!partial && runs.length === 0) return null;
  const current = runs.filter(run => run.identityScope === "current" && isFullSourceCommitSha(room.headSha)
    && isFullSourceCommitSha(run.sourceHeadSha) && run.sourceHeadSha!.toLowerCase() === room.headSha!.toLowerCase());
  const historical = runs.filter(run => run.identityScope === "historical");
  const ordinary = runs.some(run => run.reviewKind === "initiative-review");
  const conflict = runs.some(run => run.identityConflict) || current.filter(run => run.reviewKind !== "initiative-review").length > 1;
  const unresolvedHistory = historical.find(run => run.reviewKind === "initiative-review"
    && (run.executionUncertain || reviewExecutionState(run).state !== "terminal"));
  const unknownIdentity = runs.some(run => run.reviewKind === "initiative-review" && !current.includes(run) && !historical.includes(run));
  const truncated = runs.length > REVIEW_EXECUTION_LIMIT || partial;
  const observations = current.map(reviewExecutionState);
  const selected = ["unknown", "blocked", "waiting", "working", "queued", "terminal"]
    .flatMap(state => observations.filter(observation => observation.state === state))[0];
  const structuralReason = truncated ? "review-observation-incomplete"
    : conflict ? "review-identity-conflict"
      : unresolvedHistory ? "historical-review-unresolved"
        : unknownIdentity ? "review-identity-unknown"
          : current.length === 0 ? "current-review-unavailable" : null;
  const reason = structuralReason ?? selected?.reason ?? null;
  const state = structuralReason ? "unknown" as const : selected?.state ?? "unknown" as const;
  const needsIssuer = truncated || conflict || unknownIdentity || current.length === 0;
  const responsibleExecution = unresolvedHistory ? projectReviewExecution(unresolvedHistory) : selected?.execution;
  // Ordinary gates retain their exact original-result route. Native semantic
  // recovery packets cannot authorize a replacement for an ordinary review.
  const issuerAction = recoveryItemId ? { toolName: "get_backlog_item" as const,
    args: { itemId: recoveryItemId, ...(!ordinary ? { recoveryGate: "post-implementation-review" as const } : {}) } } : null;
  const nextAction = ordinary ? needsIssuer
    ? "The delivery coordinator must resolve incomplete or conflicting evidence; inspect each original request."
    : inspectOriginal
    : needsIssuer
      ? issuerAction
        ? "The delivery coordinator must read get_backlog_item with post-implementation-review recovery for the current source. Historical reviews do not authorize a retry or publication."
        : room.backlogItemId
          ? "Resolve this Workroom's recorded backlog linkage through its delivery coordinator; no semantic item ID could be confirmed. Do not retry historical work."
          : "Link this Workroom to its governing backlog item through the existing delivery coordinator, then read that item's post-implementation-review recovery. Do not retry historical work."
      : responsibleExecution?.nextAction ?? view.attentionReason ?? "Read this Workroom again to resolve the current review identity and evidence.";
  const execution = current.length === 1 && !structuralReason ? projectReviewExecution(current[0], nextAction) : null;
  return {
    state,
    reviewerExecution: execution,
    reviewerExecutions: runs.slice(0, REVIEW_EXECUTION_LIMIT).map(run => projectReviewExecution(run)),
    reviewerExecutionsTruncated: truncated,
    historicalReviewerExecutions: historical.slice(0, 5).map(run => projectReviewExecution(run,
      "Historical source only. Inspect the recorded result with its requester identity; use the current item's recovery for further action.")),
    historicalReviewHistoryTruncated: historical.length > 5 || partial,
    blocker: reason ? { reason,
      accountableOwner: needsIssuer ? { principalId: room.leaseHolderPrincipalId ?? null, role: "delivery-coordinator" as const } : responsibleExecution?.accountableOwner ?? null,
      nextAction, action: needsIssuer ? issuerAction : responsibleExecution?.resultAction ?? null } : null,
  };
}

type LinkedTaskRun = { taskRunId: string; status: string } | null;
type WorkroomReviewerExecution = NonNullable<LinkedTaskRun> & { pending: boolean | null }
  & Partial<NonNullable<NonNullable<ReturnType<typeof projectSemanticRecovery>>["reviewerExecution"]>>;

/** Room fields adopt_worktree requires besides the identity itself. */
type WorkroomRepairContext = {
  title?: string | null;
  objective?: string | null;
  backlogItemId?: string | null;
  baseBranch?: string | null;
};

/**
 * adopt_worktree refuses a call without title and objective, so a repair packet
 * that leaves them out cannot be replayed as given (observed 2026-09-23). Carry
 * every field the room already knows.
 */
function repairContextFields(room: WorkroomRepairContext): Record<string, unknown> {
  return {
    ...(room.title ? { title: room.title } : {}),
    ...(room.objective ? { objective: room.objective } : {}),
    ...(room.backlogItemId ? { backlogItemId: room.backlogItemId } : {}),
    ...(room.baseBranch ? { baseBranch: room.baseBranch } : {}),
  };
}

export function projectWorkroomIdentityRepair(
  room: WorkroomIdentity,
  packetFields: Record<string, unknown> = {},
): NonNullable<InitiativeReviewerRecovery["identityRepair"]> | null {
  const missingFields = [
    ...(!isFullSourceCommitSha(room.baseSha) ? ["baseSha" as const] : []),
    ...(!isFullSourceCommitSha(room.headSha) ? ["headSha" as const] : []),
  ];
  if (missingFields.length === 0) return null;
  const retainedFields = {
    repositoryFullName: room.repositoryFullName ?? "",
    headBranch: room.headBranch ?? "",
    worktreePath: room.worktreePath ?? "",
    ...(isFullSourceCommitSha(room.baseSha) ? { baseSha: room.baseSha } : {}),
    ...(isFullSourceCommitSha(room.headSha) ? { headSha: room.headSha } : {}),
  };
  // A caller's context cannot smuggle an unusable source value back into repair.
  const { baseSha: _base, headSha: _head, ...context } = packetFields;
  return {
    toolName: "adopt_worktree",
    missingFields,
    retainedFields,
    packet: {
      ...context,
      ...retainedFields,
    },
  };
}

export function projectWorkroomRecovery(
  room: WorkroomIdentity & WorkroomRepairContext & RecordedBlockerRoom & { taskRun?: LinkedTaskRun },
  review?: ReviewProjection,
  recoveryItemId: string | null = semanticBacklogId(room.backlogItemId) ? room.backlogItemId ?? null : null,
  now = new Date(),
  handoffRecovery: FailedHandoffRecovery | null = null,
) {
  const recordedBlocker = projectRecordedWorkroomBlocker(room, now);
  const identityRepair = projectWorkroomIdentityRepair(room, repairContextFields(room));
  // These are recorded states, not proof of a current heartbeat. In particular,
  // waiting for input or recovery must never look like queued execution.
  const executionState = room.taskRun ? projectRecordedTaskState(room.taskRun.status) : null;
  const reviewerExecution = room.taskRun
    ? {
      taskRunId: room.taskRun.taskRunId,
      status: room.taskRun.status,
      pending: executionState === "unknown" ? null : executionState !== "terminal",
    }
    : null;
  const semantic = review ? projectSemanticRecovery(room, review, semanticBacklogId(recoveryItemId) ? recoveryItemId : null) : null;
  const recoveryExecution: WorkroomReviewerExecution | null = semantic ? semantic.reviewerExecution : reviewerExecution;
  const prerequisite = identityRepair
    ? {
      accountableRole: "artifact-resolver" as const,
      missingFields: identityRepair.missingFields,
      retainedFields: identityRepair.retainedFields,
      nextAction:
        `Call adopt_worktree with this packet, adding the full 40-character commit SHA for ${identityRepair.missingFields.join(" and ")}. `
        + "Without them no reviewer can be routed to this room's source.",
      repair: { toolName: identityRepair.toolName, packet: identityRepair.packet },
    }
    : null;
  const failedHandoffRecovery = handoffRecovery?.action && (prerequisite || semantic?.blocker)
    ? { ...handoffRecovery, state: "blocked" as const, reason: "workroom-prerequisite-unresolved", action: null } : handoffRecovery;
  return {
    failedHandoffRecovery,
    state: identityRepair
      ? "blocked" as const
      : semantic?.state === "unknown" ? "unknown" as const
        : recordedBlocker ? "blocked" as const : semantic?.state ?? executionState ?? "actionable" as const,
    recordedBlocker,
    prerequisite,
    reviewerExecution: recoveryExecution,
    reviewerExecutions: semantic?.reviewerExecutions ?? (recoveryExecution ? [recoveryExecution] : []),
    reviewerExecutionsTruncated: semantic?.reviewerExecutionsTruncated ?? false,
    historicalReviewerExecutions: semantic?.historicalReviewerExecutions ?? [],
    historicalReviewHistoryTruncated: semantic?.historicalReviewHistoryTruncated ?? false,
    blocker: prerequisite ? { reason: "source-identity-missing", accountableRole: prerequisite.accountableRole,
      nextAction: prerequisite.nextAction, action: prerequisite.repair } : semantic?.blocker ?? (recordedBlocker ? {
      reason: failedHandoffRecovery?.reason ?? recordedBlocker.reason, accountableOwner: failedHandoffRecovery?.owner ?? null,
      nextAction: "Inspect the recorded blocker and verified handoff history in this Workroom before continuing.", action: failedHandoffRecovery?.action ?? null,
    } : null),
  };
}
