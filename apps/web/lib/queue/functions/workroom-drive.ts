// BI-FCD639D9 — the standing Workroom drive. DPF owns wake, lease, dispatch,
// attention, and stop. Codex/Claude/Grok/embedded coworkers are interchangeable
// workers behind ScheduledAgentTask. Quiet rooms do not wake.
//
// Mirrors obligation-assurance-watch.ts: pure exported job + thin Inngest
// wrappers behind gateAtEntry.

import { cron } from "@/lib/jobs/triggers";
import {
  driveOutcomeNeedsOwner,
  resolveDriveConclusion,
  type DriveReasonFor,
} from "@/lib/work-management/drive-conclusion";
import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";

import { NOT_ASKED_ACCOUNTABILITY, resolveAccountabilityForConclusion } from "./workroom-drive-accountability";
import { liveDriveTaskOwnerEffects, MISSING_TASK_OWNER_REASON, settleTickTaskOwner } from "./workroom-drive-task-owner";
import type { PrismaClient } from "@dpf/db";
import { jobs } from "@/lib/jobs";
import { isRecord } from "@/lib/shared/coerce";
import {
  jsiSchemePresent,
  resolveCoordinatorEligibility,
} from "@/lib/work-management/coordinator-eligibility";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";
import { buildStageBrief, stageBriefInputFromDefinition, stageEvidenceKinds } from "@/lib/work-management/stage-briefing";
import { type WorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
import { driveTickIsNews, nextDriveHold, readDriveHold, stallNoticeDue, type WorkroomDriveHold } from "@/lib/work-management/workroom-drive-hold";
import { readWorkroomQueueHold } from "@/lib/work-capsules/workroom-queue-hold";

import {
  loadCoordinationBindings,
  loadRecordedEvidence,
  loadStageDispatchTimes,
  loadStageDispatchTimesByStage,
  loadStandingRoomIds,
  loadWorkItemStatuses,
  reconcileCoordinationBindings,
  reconcileStandingRoomNesting, deactivateUndrivenRoomTasks, taskLeftBehind, workItemKeyOf, // BI-1DDCE164
} from "./workroom-drive-data";
export { loadStandingRoomIds, STANDING_ROOM_SCAN_LIMIT } from "./workroom-drive-data";
import { earnGraphReceipts, graphSnapshotFields, hasStoredDriveMarking, withLatchedBlockedReceipts } from "@/lib/work-management/drive-graph-tick";
import { applyGraphDrivePlan } from "./workroom-drive-graph";
import type { DeadlineNoticeInput } from "./workroom-drive-deadlines";
import { createSubShapeChildEffects, withSubShapeChildren, type SubShapeChildEffects } from "./workroom-drive-children";
import type { SubShapeChildObservation } from "@/lib/work-management/drive-child-rooms";
import { applyReviewerDispatch, liveReviewerDispatch, reviewStageResolver, withReviewReceiptEvidence, type ReviewerDispatchEffect, type ReviewStageDeps, type ReviewStageOverlay } from "./workroom-drive-review-stages";
import { earnEvidenceReceipts, type RecordedEvidence } from "@/lib/work-management/stage-evidence-receipts";
import { sequentialRunFor } from "@/lib/work-management/drive-sequential-run";
import { readWritebackRetry, type StageRunObservation } from "@/lib/work-management/writeback-latch";
import { loadDispatchCapacity, withStageRuns } from "./workroom-drive-stage-run";
import { createDispatchAdmission, orderRoomsOldestWaitingFirst, type DriveDispatchCapacity } from "@/lib/work-management/drive-dispatch-cap";

import { gateAtEntry } from "../quiescence-gates";
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import {
  WORKROOM_DRIVE_ACTIVITY_KIND,
  WORKROOM_DRIVE_ATTENTION_KIND,
  WORKROOM_DRIVE_CRON,
  WORKROOM_DRIVE_INNGEST_ID,
  WORKROOM_DRIVE_LEASE_MS,
  WORKROOM_DRIVE_REQUESTED_EVENT,
  WORKROOM_DRIVE_RUN_NOW_INNGEST_ID,
} from "@/lib/work-management/workroom-drive-constants";
import {
  projectPersistedWorkroomRoster,
  type ProjectableWorkroomParticipantAssignment,
} from "@/lib/work-management/room-participant-assignment";
import { readWorkroomPostureClaim } from "@/lib/work-management/workroom-posture-claim";
import { readWorkShapeDefinitionContract } from "@/lib/work-management/work-shapes";
import { readWorkShapeRoleBindings, resolveWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { loadAuthorStageAutonomy, NO_AUTHOR_STAGE_AUTONOMY, type AuthorStageAutonomyFor } from "@/lib/work-management/author-stage-autonomy-live";
import { gateDrivePlanOnWorkItem } from "@/lib/work-management/drive-work-item-gate";
import {
  EXECUTOR_WRITEBACK_UNAVAILABLE_REASON,
  resolveDrivePlan,
  workroomDriveTaskId,
  type DrivePlan,
} from "@/lib/work-management/drive-resolution";
import type { WorkroomCoordinatorEligibility } from "@/lib/work-management/workroom-shape-conformance";
import {
  priorDriveFromStored,
  readStoredWorkroomDriveState,
} from "@/lib/work-management/workroom-drive-state";
import { WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND } from "@/lib/work-management/workroom-drive-receipts";
import { mergeWorkroomDriveSnapshot } from "@/lib/work-management/workroom-drive-snapshot-merge";
import { scheduleWorkroomAgentTask } from "./workroom-drive-scheduling";
import { overseeDriveRooms, type DriveOverseerDeps, type DriveOverseerResult } from "./workroom-overseer-run"; // BI-8E1486FA
export { mergeWorkroomDriveSnapshot } from "@/lib/work-management/workroom-drive-snapshot-merge";
import { loadHandedOverUserIds, repairUnownedDeliveryRooms, ROOM_OWNER_USER_INCLUDE, roomOwnerUserId } from "@/lib/work-management/delivery-room-ownership";

export type WorkroomDriveRoom = {
  id: string;
  capsuleId: string;
  /** BI-8A32EBFF: the item the room delivers, for the author-stage budget check. */
  backlogItemId?: string | null;
  /** BI-72679FE0: that item's status; a room whose item is not live work stands down. */
  workItemStatus?: string | null;
  scopeClaims: unknown;
  workspaceState: unknown;
  leaseExpiresAt: Date | null;
  leaseHolderPrincipalId: string | null;
  ownerUserId: string | null;
  participants: ProjectableWorkroomParticipantAssignment[];
  currentStageKey: string | null;
  receipts: { stageKey: string; kind: string; iteration?: number }[];
  /** The room's own objective, sent to the coworker in its stage brief. */
  objective?: string | null;
  workItemKey?: string | null; // BI-1DDCE164: the item's semantic id (BI-*), named in the brief
  /** Stage-scoped evidence recorded through record_workroom_evidence — the only
   *  thing a completing receipt is earned from (BI-76B35820). */
  recordedEvidence?: RecordedEvidence[];
  /** When the current stage was most recently dispatched. */
  stageDispatchedAt?: Date | null;
  /** BI-7C0B2BD6: what the room's task shows about the queued run; null when no task exists, absent when unread. */
  stageRun?: StageRunObservation | null;
  stageRunsByTask?: Readonly<Record<string, StageRunObservation | null>>;
  /** Graph rooms only (Phase 3c): when each marked stage most recently started. */
  stageDispatchedAtByStage?: ReadonlyMap<string, Date> | null;
  /** Graph rooms only (PR-3c-5): each live sub-shape child's status and drive action/reason, by capsule id. */
  subShapeChildren?: Readonly<Record<string, SubShapeChildObservation>>;
  budgetUsage: { kind: string; used: number }[];
  stopConditionHits: string[];
  reviewDue: boolean;
  substrateReachable: boolean;
  substrateEmpty: boolean;
  /** Current verifier-readable JSI and TAK eligibility for an AI coordinator. */
  coordinatorEligibility?: WorkroomCoordinatorEligibility | null;
};

export type WorkroomDriveEffects = SubShapeChildEffects & {
  /**
   * BI-12A083B4: who answers for this room, asked ONLY when a tick ends in a
   * blockage. Resolving it walks the room's containment lineage, so the drive
   * does not pay for that on work that is moving or finished.
   *
   * Optional so existing callers and tests keep working. When it is absent the
   * conclusion records `unconcluded` with the reason, which is the honest
   * answer: nobody was asked, so nobody is named.
   */
  resolveAccountability?: (roomId: string) => Promise<EffectiveHumanAccountability>;
  /** BI-D13FA12A: the active user an accountable human principal maps to, for a room that records no owner user. */
  resolvePrincipalUserId?: (principalId: string) => Promise<string | null>;
  persist: (input: {
    roomId: string;
    snapshot: Record<string, unknown>;
    activityKind: string;
    summary: string;
    payload: Record<string, unknown>;
    observationOnly?: boolean;
    /** Update the snapshot but add no trail row: the hold did not change (BI-E8C78E80). */
    quiet?: boolean;
    /** The snapshot is for a graph-path shape: the merge keeps the row's marking (Phase 3c). */
    graphShape?: boolean;
    lease?: { expiresAt: Date; holderPrincipalId: string | null };
  }) => Promise<void>;
  /** Tell a stuck room's owner once per stuck spell (BI-E8C78E80). Optional; tests may omit it. */
  notifyStall?: (input: { room: WorkroomDriveRoom; hold: WorkroomDriveHold; reason: string; conformance: unknown }) => Promise<void>;
  acquireLease: (input: {
    roomId: string;
    now: Date;
    holderPrincipalId: string | null;
    expiresAt: Date;
    currentExpiresAt: Date | null;
    currentHolder: string | null;
  }) => Promise<"acquired" | "held">;
  upsertAgentTask: (input: {
    taskId: string;
    agentId: string;
    ownerUserId: string;
    dispatchScope?: import("@/lib/work-management/workroom-drive-checkpoint").DispatchScope;
    title: string;
    prompt: string;
    /** Stage + declared tools, written to taskConfig.workroomStage for the scheduler's pin (BI-43C3E914). */
    stage: WorkroomStageTaskConfig;
    now: Date;
    lease: { roomId: string; expiresAt: Date; holderPrincipalId: string | null };
  }) => Promise<boolean>;
  deactivateAgentTask: (taskId: string) => Promise<void>;
  dispatchReviewer?: ReviewerDispatchEffect;
  /** Revoke the permits of the stages a rework left (GPP Phase 3c PR-3c-3). Optional; graph rooms only. */
  revokeStagePermits?: (input: { workroomId: string; stageKeys: readonly string[]; now: Date }) => Promise<number>;
  /** Tell the escalation target a stage passed its deadline (PR-3c-4). True only when sent; anything else retries next tick. */
  notifyDeadline?: (input: DeadlineNoticeInput) => Promise<boolean>;
};

export type WorkroomDriveResult = DriveOverseerResult & {
  runId: string;
  scanned: number;
  dispatched: number;
  attention: number;
  stopped: number;
  skipped: number;
  /** `contains` relations added this tick. Zero does not prove nesting is
   * complete: unchanged trees, absent parents and contained failures all yield
   * zero. Read persisted relations to establish hierarchy coverage. */
  nestedRelations: number;
  plans: Array<{ roomId: string; action: string; reason: string; taskId: string | null }>;
};

// One terminal rule for the drive and the nesting it walks (BI-CFB3FDB7).
const TERMINAL = TERMINAL_WORKROOM_STATUSES;

function postureLevelOf(scopeClaims: unknown): ProactivityLevel | null {
  const declared = readWorkroomPostureClaim(scopeClaims)?.proactivityLevel;
  if (declared === "quiet" || declared === "balanced" || declared === "assertive") return declared;
  return "balanced";
}

export async function applyDrivePlan(input: {
  room: WorkroomDriveRoom;
  plan: DrivePlan;
  now: Date;
  effects: WorkroomDriveEffects;
  /** Sequential rooms only (BI-853120EE): the run this tick belongs to. Stamped on the snapshot and on a new blocked receipt. */
  runKey?: string;
  review?: ReviewStageOverlay | null; // set when the stage was rebound to its readiness reviewer
}): Promise<"dispatched" | "attention" | "stopped" | "skipped"> {
  const { now, effects, runKey } = input;
  // Graph shapes only (Phase 3c): marking carry-forward and the marked keys. Null for every sequential room.
  const graph = graphSnapshotFields(input.plan, input.room.workspaceState);
  // BI-D13FA12A: settle who the task runs for before anything is recorded; an ownerless dispatch becomes a pause.
  const reviewerBound = Boolean(input.review?.binding.requestCoworker && input.review.binding.stageKey === input.plan.stageKey);
  const owner = await settleTickTaskOwner({ room: input.room, plan: input.plan, effects, dispatches: graph
    ? graph.dispatching : input.plan.action === "dispatch_agent" && Boolean(input.plan.taskId && input.plan.agentId) && !reviewerBound });
  const plan = owner.plan;
  const room = { ...input.room, ownerUserId: owner.ownerUserId };
  const receipts = graph ? withLatchedBlockedReceipts(plan, room.receipts) : [...room.receipts];
  if (
    !graph
    && plan.reason === EXECUTOR_WRITEBACK_UNAVAILABLE_REASON
    && plan.stageKey
    && !receipts.some((receipt) =>
      receipt.stageKey === plan.stageKey && receipt.kind === WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND
    )
  ) {
    receipts.push({ stageKey: plan.stageKey, kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND, ...(runKey !== undefined ? { runKey } : {}) });
  }
  // BI-12A083B4 — no work stops without a conclusion. Every tick records which
  // of the three legitimate states it reached: the outcome is met, work
  // continues, or a blockage is named with an owner and the event that clears
  // it. A tick that concluded none of those records `unconcluded`, which is a
  // defect surfaced rather than a room left silently waiting on nobody.
  const needsOwner = driveOutcomeNeedsOwner({
    action: plan.action,
    reason: plan.reason,
    attentionPrincipalRef: plan.attentionPrincipalRef,
  });
  const accountability: EffectiveHumanAccountability = needsOwner
    ? owner.accountability ?? await resolveAccountabilityForConclusion(room.id, effects.resolveAccountability)
    : NOT_ASKED_ACCOUNTABILITY;
  const conclusion = resolveDriveConclusion({
    action: plan.action,
    reason: plan.reason,
    attentionPrincipalRef: plan.attentionPrincipalRef,
    accountability,
  });

  const priorHold = readDriveHold(room.workspaceState);
  const hold = nextDriveHold(priorHold, { action: plan.action, reason: plan.reason, stageKey: plan.stageKey, conformance: plan.conformance,
    ...(graph?.markedKeys ? { markedKeys: graph.markedKeys } : {}) }, now);
  if (stallNoticeDue(hold) && effects.notifyStall) {
    await effects.notifyStall({ room, hold, reason: plan.reason, conformance: plan.conformance })
      .then(() => { hold.notifiedAt = now.toISOString(); }, () => undefined);
  }
  const quiet = !driveTickIsNews(priorHold, hold, plan.action,
    graph ? graph.iterationChanged || (graph.dispatching && room.ownerUserId !== null) : undefined);
  const persist: WorkroomDriveEffects["persist"] = (args) =>
    effects.persist({ ...args, quiet: quiet && !args.observationOnly, ...(graph ? { graphShape: true } : {}) });

  const snapshot = {
    kind: "workroom-drive",
    version: 1,
    action: plan.action,
    reason: plan.reason,
    conclusion,
    stageKey: plan.stageKey,
    taskId: plan.taskId,
    lastRunAt: now.toISOString(),
    lastCycleKey: plan.cycle?.cycleKey ?? null,
    ...(runKey !== undefined && !graph ? { runKey } : {}),
    ...(plan.writebackRetry !== undefined ? { writebackRetry: plan.writebackRetry } : {}),
    receipts,
    budgetUsage: room.budgetUsage,
    stopConditionHits: room.stopConditionHits,
    reviewDue: room.reviewDue,
    pendingAttention: plan.action === "attention"
      ? {
        principalRef: plan.attentionPrincipalRef,
        stageKey: plan.stageKey,
        reason: plan.reason,
      }
      : null,
    conformance: plan.conformance,
    ledger: plan.ledger,
    hold,
    ...(owner.taskOwner ? { taskOwner: owner.taskOwner } : {}),
    ...graph?.fields,
  };
  // A graph room dispatches one task per branch (PR-3c-2); a sequential room never takes this branch.
  if (graph) return applyGraphDrivePlan({ room, plan, now, effects, snapshot, persist });

  if (plan.action === "do_not_wake") {
    if (plan.shapeKey) {
      await effects.deactivateAgentTask(workroomDriveTaskId(room.capsuleId, plan.shapeKey));
    }
    await persist({
      roomId: room.id,
      snapshot,
      activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
      summary: `Drive did not wake: ${plan.reason}`,
      payload: snapshot,
    });
    return "skipped";
  }

  if (plan.action === "attention") {
    const left = taskLeftBehind(room, plan); if (left) await effects.deactivateAgentTask(left); // BI-1DDCE164
    await persist({
      roomId: room.id,
      snapshot,
      activityKind: WORKROOM_DRIVE_ATTENTION_KIND,
      summary: `Stage ${plan.stageKey ?? "unknown"} waiting on ${plan.attentionPrincipalRef ?? "a human"}`,
      payload: snapshot,
    });
    return "attention";
  }

  if (plan.action === "dispatch_agent") {
    if (!plan.taskId || !plan.agentId) return "skipped";
    if (readWorkroomQueueHold(room.workspaceState)) {
      // BI-2B6A8A74: no provider answered the last stage; dispatching again would retry the outage.
      const held = { ...snapshot, reason: "provider_held" satisfies DriveReasonFor<"dispatch_agent"> };
      await persist({ roomId: room.id, snapshot: held, activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
        summary: "Queue held after a provider failure; resume_workroom_queue releases it.", payload: held });
      return "skipped";
    }
    const expiresAt = new Date(now.getTime() + WORKROOM_DRIVE_LEASE_MS);
    const lease = await effects.acquireLease({
      roomId: room.id,
      now,
      holderPrincipalId: room.leaseHolderPrincipalId,
      expiresAt,
      currentExpiresAt: room.leaseExpiresAt,
      currentHolder: room.leaseHolderPrincipalId,
    });
    if (lease === "held") {
      await persist({
        roomId: room.id,
        snapshot: { ...snapshot, reason: "lease_held" satisfies DriveReasonFor<"dispatch_agent"> },
        activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
        summary: "Drive lease held by another worker; stage remains eligible when it expires.",
        payload: { ...snapshot, reason: "lease_held" satisfies DriveReasonFor<"dispatch_agent"> },
        observationOnly: true,
      });
      return "skipped";
    }
    if (input.review?.binding.requestCoworker && input.review.binding.stageKey === plan.stageKey) return applyReviewerDispatch({
      room, plan, overlay: input.review, snapshot, now, persist, lease: { expiresAt, holderPrincipalId: room.leaseHolderPrincipalId }, dispatch: effects.dispatchReviewer });
    // Unreachable: settleTickTaskOwner rewrote an ownerless dispatch to a pause above.
    if (!room.ownerUserId) return "skipped";
    // GPP element 2 "Attachment" + element 5 "Capability set": the brief and the
    // task carry the stage's declared tools; the scheduler pins them (BI-43C3E914).
    const brief = stageBriefInputFromDefinition({ capsuleId: room.capsuleId, roomObjective: room.objective ?? null, backlogItemKey: room.workItemKey ?? null,
      shapeKey: plan.shapeKey ?? "", shapeVersion: plan.shapeVersion ?? "", definition: plan.definition ?? null, stageKey: plan.stageKey ?? "" });
    const scheduled = await effects.upsertAgentTask({
      taskId: plan.taskId,
      agentId: plan.agentId,
      ownerUserId: room.ownerUserId,
      title: `Workroom ${room.capsuleId} / ${plan.stageKey}`,
      // The old prompt was the stage KEY plus three prohibitions, and 337 runs
      // answered it with prose and zero tool calls (BI-4A394B21). The shape
      // already carries the objective, the definition of done and the evidence
      // to leave; send it.
      prompt: buildStageBrief(brief),
      stage: { shapeKey: brief.shapeKey, shapeVersion: brief.shapeVersion, stageKey: brief.stageKey, tools: [...(brief.stageTools ?? [])] },
      ...(plan.cycle ? { dispatchScope: { runKey: runKey ?? plan.cycle.cycleKey, cycleKey: plan.cycle.cycleKey, iteration: plan.dispatchAttempt ?? 0 } } : {}),
      now,
      lease: { roomId: room.id, expiresAt, holderPrincipalId: room.leaseHolderPrincipalId },
    });
    if (!scheduled) return "skipped";
    await persist({
      roomId: room.id,
      snapshot,
      activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
      summary: `Dispatched ${plan.taskId} for stage ${plan.stageKey}${owner.taskOwner ? ` for the accountable person (${String(owner.taskOwner.source)})` : ""}`,
      payload: snapshot,
      lease: { expiresAt, holderPrincipalId: room.leaseHolderPrincipalId },
    });
    return "dispatched";
  }

  await persist({
    roomId: room.id,
    snapshot,
    activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
    summary: plan.reason === MISSING_TASK_OWNER_REASON
      ? `Stage ${plan.stageKey ?? "unknown"} not dispatched: ${String(owner.taskOwner?.missing ?? "no task owner")}`
      // Only a latch that read the task names what it waits on (BI-7C0B2BD6); the cycle-rule line is unchanged.
      : plan.writebackRetry !== undefined && plan.ledger[0] ? plan.ledger[0] : `Drive ${plan.action}: ${plan.reason}`,
    payload: snapshot,
  });
  // BI-7C0B2BD6: a latch held for a run still outstanding must not switch off the task it waits on.
  if (plan.shapeKey && !plan.keepTaskActive) {
    await effects.deactivateAgentTask(workroomDriveTaskId(room.capsuleId, plan.shapeKey));
  }
  return plan.action === "stop" ? "stopped" : "skipped";
}

export async function runWorkroomDriveJob(
  now: Date = new Date(),
  deps?: DriveOverseerDeps & {
    listRooms?: () => Promise<WorkroomDriveRoom[]>;
    effects?: WorkroomDriveEffects;
    reconcileNotifications?: () => Promise<void>;
    reconcileNesting?: () => Promise<number>;
    authorStageAutonomy?: (rooms: WorkroomDriveRoom[], now: Date) => Promise<AuthorStageAutonomyFor>;
    reviewStages?: ReviewStageDeps | null;
    /** BI-7C0B2BD6: this tick's agent dispatch capacity. Defaults to the live pools; caller-supplied rooms are uncapped. */
    dispatchCapacity?: () => Promise<DriveDispatchCapacity>;
  },
): Promise<WorkroomDriveResult> {
  // Materialize the declared nesting before driving. The tree is declared in
  // standing-rooms.ts and, until BI-AEAA90A9, was written nowhere: this install
  // held eighteen standing rooms and ZERO relations, so the five parents floated
  // unlinked from their children and every hierarchy walk ran over an empty set.
  // Idempotent and cheap (one insert with skipDuplicates), so it costs a settled
  // estate nothing per tick.
  // A caller supplying its own room list owns nesting too, so the live
  // reconciler runs only alongside the live loader.
  const reconcile =
    deps?.reconcileNesting ?? (deps?.listRooms ? async () => 0 : reconcileStandingRoomNesting);
  const nested = await reconcile();

  let rooms: WorkroomDriveRoom[];
  if (deps?.listRooms) {
    rooms = await deps.listRooms();
  } else {
    await Promise.all([reconcileCoordinationBindings(), deactivateUndrivenRoomTasks()]); // BI-1DDCE164: stop tasks of unselected rooms
    const { prisma } = await import("@dpf/db");
    const [bindings, schemePresent] = [
      await loadCoordinationBindings(),
      jsiSchemePresent(prisma as unknown as Record<string, unknown>),
    ];
    rooms = await loadStandingRooms(bindings, schemePresent);
    // Stage-scoped evidence (a review stage's: its readiness receipts, BI-80738C08) is
    // the ONLY thing a completing receipt is earned from; without it a room never advances.
    const evidenceByRoom = await loadRecordedEvidence(rooms.map((room) => room.capsuleId));
    const statusByItem = await loadWorkItemStatuses(rooms.map((room) => room.backlogItemId ?? ""));
    const dispatchByRoom = await loadStageDispatchTimes(rooms.map((room) => room.capsuleId));
    const dispatchByStage = await loadStageDispatchTimesByStage(
      rooms.filter((room) => hasStoredDriveMarking(room.workspaceState)).map((room) => room.capsuleId));
    rooms = await withSubShapeChildren(await withReviewReceiptEvidence(rooms.map((room) => ({
      ...room,
      recordedEvidence: evidenceByRoom.get(room.capsuleId) ?? [],
      workItemStatus: room.backlogItemId ? statusByItem.get(room.backlogItemId) ?? null : null,
      stageDispatchedAt: dispatchByRoom.get(room.capsuleId) ?? null,
      ...(dispatchByStage.has(room.capsuleId) ? { stageDispatchedAtByStage: dispatchByStage.get(room.capsuleId) } : {}),
    }))));
    // BI-7C0B2BD6: the writeback latch reads each room's task, so it holds only while a run is outstanding.
    rooms = await withStageRuns(rooms);
  }
  const overseen = await overseeDriveRooms(rooms, now, deps); rooms = overseen.rooms; // BI-8E1486FA: close finished rooms first
  const effects = deps?.effects ?? createWorkroomDriveEffects();
  // BI-7C0B2BD6 / DI-7109D22D4812: dispatch no more than agent capacity allows; the rest wait, oldest first.
  rooms = orderRoomsOldestWaitingFirst(rooms);
  const admit = createDispatchAdmission(await (deps?.dispatchCapacity
    ?? (deps?.listRooms ? async () => ({ cap: Number.POSITIVE_INFINITY, reason: "caller-supplied rooms" }) : () => loadDispatchCapacity(now)))());
  // BI-8A32EBFF: an agent runs role:author delivery stages only under the operator pre-authorisation, within budget.
  const authorStage = await (deps?.authorStageAutonomy ?? (deps?.listRooms ? async () => NO_AUTHOR_STAGE_AUTONOMY : loadAuthorStageAutonomy))(rooms, now);
  const resolveWithReview = reviewStageResolver(deps); // bounded readiness reads per tick (BI-2C8750FC)
  const plans: WorkroomDriveResult["plans"] = [];
  let dispatched = 0;
  let attention = 0;
  let stopped = 0;
  let skipped = 0;

  for (const room of rooms) {
    // BI-7C0B2BD6: one room's failure is recorded and the tick goes on; it once ended the tick for every room after it.
    try {
    const shape = resolveWorkShapeClaim(room.scopeClaims);
    const author = authorStage(room, shape?.key ?? null);
    const stored = readStoredWorkroomDriveState(room.workspaceState);
    const existing = room.receipts.length > 0 ? room.receipts : stored.receipts;
    // BI-853120EE: a sequential room's receipts belong to its run; a new run starts with none.
    const run = sequentialRunFor({ shape, workspaceState: room.workspaceState, now, prior: priorDriveFromStored(stored), receipts: existing });
    const receipts = (earnGraphReceipts({ definition: shape ? readWorkShapeDefinitionContract(shape) : null, workspaceState: room.workspaceState,
      evidence: room.recordedEvidence ?? [], dispatchedAtByStage: room.stageDispatchedAtByStage, existing,
    }) ?? earnEvidenceReceipts({
      stageKey: room.currentStageKey ?? stored.currentStageKey,
      declaredKinds: stageEvidenceKinds(shape ? readWorkShapeDefinitionContract(shape) : null, room.currentStageKey ?? stored.currentStageKey),
      evidence: room.recordedEvidence ?? [],
      dispatchedAt: room.stageDispatchedAt ?? null,
      existing: run?.receipts ?? existing,
      ...(run ? { runKey: run.runKey } : {}),
    })) as { stageKey: string; kind: string; iteration?: number; runKey?: string }[];
    const driveInput: Parameters<typeof resolveDrivePlan>[0] = {
      roomId: room.capsuleId,
      definition: shape ? readWorkShapeDefinitionContract(shape) : null,
      collaborationShape: shape?.collaborationShape ?? null,
      postureLevel: postureLevelOf(room.scopeClaims),
      participants: projectPersistedWorkroomRoster({
        assignments: room.participants,
        presencePrincipalRefs: [],
      }),
      currentStageKey: room.currentStageKey ?? stored.currentStageKey,
      // Earned from governed, stage-scoped evidence only — never from a run's
      // self-reported completion (BI-76B35820).
      receipts,
      budgetUsage: room.budgetUsage.length > 0 ? room.budgetUsage : stored.budgetUsage,
      stopConditionHits: room.stopConditionHits.length > 0 ? room.stopConditionHits : stored.stopConditionHits,
      reviewDue: room.reviewDue || stored.reviewDue,
      substrateReachable: room.substrateReachable,
      substrateEmpty: room.substrateEmpty,
      coordinatorEligibility: room.coordinatorEligibility,
      now,
      priorDrive: priorDriveFromStored(stored),
      writebackRetry: readWritebackRetry(isRecord(room.workspaceState) ? room.workspaceState.workroomDrive : undefined),
      ...(room.stageRun !== undefined ? { stageRun: room.stageRun } : {}),
      ...(room.stageRunsByTask !== undefined ? { stageRunsByTask: room.stageRunsByTask } : {}),
      workspaceState: room.workspaceState,
      recordedEvidence: room.recordedEvidence ?? [],
      ...(room.subShapeChildren ? { subShapeChildren: room.subShapeChildren } : {}),
      roleBindings: { ...author.roleBindings, ...readWorkShapeRoleBindings(room.scopeClaims) },
      authorStageWithheldBecause: author.withheldBecause,
    };
    const resolved = await resolveWithReview(room, driveInput);
    // BI-72679FE0: a room whose item is done, deferred or delivered gets no agent and raises no stall.
    // BI-7C0B2BD6: then the capacity cap, so a stood-down room never takes a dispatch slot.
    const itemPlan = gateDrivePlanOnWorkItem(resolved.plan, room.workItemStatus);
    // BI-9CD95438: applyDrivePlan still records the hold; known-held rooms do not spend a slot.
    const plan = readWorkroomQueueHold(room.workspaceState) ? itemPlan : admit(itemPlan);
    const review = plan === resolved.plan ? resolved.review : null;
    plans.push({
      roomId: room.capsuleId,
      action: plan.action,
      reason: plan.reason,
      taskId: plan.taskId,
    });
    const outcome = await applyDrivePlan({ room: { ...room, receipts }, plan, now, effects, review, ...(run ? { runKey: run.runKey } : {}) });
    if (outcome === "dispatched") dispatched += 1;
    else if (outcome === "attention") attention += 1;
    else if (outcome === "stopped") stopped += 1;
    else skipped += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[workroom-drive] room ${room.capsuleId} failed; continuing the tick:`, error);
      // The room's plan was not carried out, so the error replaces it in the tick's result.
      if (plans.at(-1)?.roomId === room.capsuleId) plans.pop();
      plans.push({ roomId: room.capsuleId, action: "error", reason: message.slice(0, 280), taskId: null });
      skipped += 1;
    }
  }

  try {
    if (deps?.reconcileNotifications) {
      await deps.reconcileNotifications();
    } else if (!deps) {
      const { reconcileDeliveryTaskNotificationsLive } = await import("@/lib/work-capsules/delivery-task-notifications-live");
      await reconcileDeliveryTaskNotificationsLive(now);
    }
  } catch {
    // Notification projection is advisory. Delivery state was already persisted
    // and must not be rolled back when the inbox or realtime bus is unavailable.
  }

  return {
    runId: `workroom-drive:${now.toISOString()}`,
    scanned: rooms.length,
    nestedRelations: nested,
    dispatched,
    attention,
    stopped,
    skipped,
    plans, ...(overseen.overseer ? { overseer: overseen.overseer } : {}), // absent when the duty did not run, so caller-supplied ticks are unchanged
  };
}

async function loadStandingRooms(
  coordinationBindings?: Map<
    string,
    Array<{ status: string; scopeType: string; resourceType: string; resourceRef: string }>
  >,
  schemePresent = false,
): Promise<WorkroomDriveRoom[]> {
  const { prisma } = await import("@dpf/db");
  const ids = await loadStandingRoomIds(prisma as never);
  if (ids.length === 0) return [];
  // BI-E8C78E80: rooms from before delivery work was born owned get their owner first.
  await repairUnownedDeliveryRooms(prisma as never, ids).catch((error) => console.warn("[workroom-drive] owner repair skipped:", error));
  const rows = await prisma.workroom.findMany({
    where: {
      id: { in: ids },
      archivedAt: null,
      status: { notIn: [...TERMINAL] },
    },
    include: {
      participants: {
        where: { lifecycle: "active" },
        include: {
          principal: {
            select: {
              principalId: true,
              displayName: true,
              kind: true,
              authorityMode: true,
              sponsorPrincipal: { select: { principalId: true, displayName: true } },
            },
          },
        },
      },
      ...ROOM_OWNER_USER_INCLUDE,
    },
  });
  // BI-858FDE5A: a handed-over requester/creator no longer names a new task's owner.
  const handedOverUserIds = await loadHandedOverUserIds(prisma as never);

  return rows.flatMap((row) => {
    const shapeRef = resolveWorkShapeClaim(row.scopeClaims);
    if (!shapeRef) return [];
    // Authority is granted over the shape, not one of its revisions.
    const shapeKey = shapeRef.key;
    return [{
      id: row.id,
      capsuleId: row.capsuleId,
      backlogItemId: row.backlogItemId,
      objective: row.objective, workItemKey: workItemKeyOf(row),
      coordinatorEligibility: resolveCoordinatorEligibility({
        shapeKey,
        bindings: (shapeKey ? coordinationBindings?.get(shapeKey) : undefined) ?? [],
        schemePresent,
      }),
      scopeClaims: row.scopeClaims,
      workspaceState: row.workspaceState,
      leaseExpiresAt: row.leaseExpiresAt,
      leaseHolderPrincipalId: row.leaseHolderPrincipalId,
      ownerUserId: roomOwnerUserId(row, handedOverUserIds),
      participants: row.participants.map((participant) => {
        const kind = participant.principal.kind === "agent"
          ? "agent" as const
          : participant.principal.kind === "system" || participant.principal.kind === "service"
            ? "system" as const
            : participant.principal.kind === "external"
              ? "external" as const
              : "person" as const;
        return {
          workroomId: row.id,
          principalRef: participant.principal.principalId,
          displayName: participant.principal.displayName,
          kind,
          roles: [...participant.roles],
          assignmentSource: participant.assignmentSource,
          enteredReason: participant.enteredReason,
          currentWorkSummary: participant.currentWorkSummary,
          sponsorPrincipalRef: participant.principal.sponsorPrincipal?.principalId ?? null,
          sponsorDisplayName: participant.principal.sponsorPrincipal?.displayName ?? null,
          authoritySummary: "",
        };
      }),
      ...readStoredWorkroomDriveState(row.workspaceState),
      substrateReachable: true,
      substrateEmpty: false,
    }];
  });
}

export function createWorkroomDriveEffects(
  loadDb: () => Promise<Pick<PrismaClient, "workroom" | "workroomActivity" | "scheduledAgentTask" | "$transaction">>
    = async () => (await import("@dpf/db")).prisma,
  clock: () => Date = () => new Date(),
): WorkroomDriveEffects {
  return {
    ...createSubShapeChildEffects(loadDb as never),
    // BI-12A083B4: the drive asks accountability only when a tick ends stuck,
    // so a blockage can name who clears it instead of waiting on nobody.
    // BI-D13FA12A/BI-17238133: the same effects name a task's owner, shared
    // with the scheduled-room mandate that re-checks it.
    ...liveDriveTaskOwnerEffects(loadDb),
    notifyStall: async (input) => (await import("@/lib/work-management/workroom-stall-notice")).notifyWorkroomStall(input),
    revokeStagePermits: async (input) => (await import("@/lib/gpp/stage-permit-revocation")).revokeStagePermits(input),
    notifyDeadline: async (input) => (await import("@/lib/work-management/workroom-deadline-notice")).notifyWorkroomDeadline(input),
    dispatchReviewer: liveReviewerDispatch,
    async persist(input) {
      const prisma = await loadDb();
      const prior: { state: { workspaceState: unknown; capsuleId: string; scopeClaims: unknown } | null } = { state: null }; // set in the transaction
      const activity = await prisma.$transaction(async (tx) => {
        if (!input.observationOnly) {
          const current = await tx.workroom.findUnique({
            where: { id: input.roomId },
            select: { workspaceState: true, updatedAt: true, capsuleId: true, scopeClaims: true },
          });
          if (!current) return null;
          prior.state = current;
          const snapshot = mergeWorkroomDriveSnapshot(current.workspaceState, input.snapshot, { graphShape: input.graphShape });
          const updated = await tx.workroom.updateMany({
            where: {
              id: input.roomId, updatedAt: current.updatedAt, archivedAt: null, status: { notIn: [...TERMINAL] },
              ...(input.lease ? {
                leaseExpiresAt: input.lease.expiresAt, leaseHolderPrincipalId: input.lease.holderPrincipalId,
                AND: [{ leaseExpiresAt: { gt: clock() } }],
              } : {}),
            },
            data: { workspaceState: { ...(isRecord(current.workspaceState) ? current.workspaceState : {}), workroomDrive: snapshot } as object },
          });
          if (updated.count !== 1) return null;
        }
        if (input.quiet) return null;
        return tx.workroomActivity.create({
          data: {
            workCapsuleId: input.roomId,
            kind: input.activityKind,
            summary: input.summary,
            payload: input.payload as object,
          },
        });
      });
      if (!activity) return;
      const { publishRecordedWorkCapsuleActivity } = await import("@/lib/work-capsules/activity-events");
      publishRecordedWorkCapsuleActivity(input.roomId, activity.id);
      // EP-B70E718D F2: the trail row just written is a state change, so the stage's queue moves with it.
      if (prior.state) {
        const { emitStageTelemetryForDriveWrite } = await import("@/lib/work-management/workroom-stage-telemetry");
        void emitStageTelemetryForDriveWrite({ room: prior.state, snapshot: input.snapshot, graphShape: input.graphShape, at: clock() });
      }
    },
    async acquireLease(input) {
      if (input.currentExpiresAt && input.currentExpiresAt.getTime() > input.now.getTime()) {
        return "held";
      }
      const prisma = await loadDb();
      const claimed = await prisma.workroom.updateMany({
        where: {
          id: input.roomId,
          archivedAt: null,
          status: { notIn: [...TERMINAL] },
          leaseExpiresAt: input.currentExpiresAt,
          leaseHolderPrincipalId: input.currentHolder,
        },
        data: {
          leaseExpiresAt: input.expiresAt,
          leaseHolderPrincipalId: input.holderPrincipalId,
        },
      });
      return claimed.count === 1 ? "acquired" : "held";
    },
    async upsertAgentTask(input) {
      const prisma = await loadDb();
      return scheduleWorkroomAgentTask(prisma, input, clock);
    },
    async deactivateAgentTask(taskId) {
      const prisma = await loadDb();
      await prisma.scheduledAgentTask.updateMany({
        where: { taskId },
        data: { isActive: false },
      });
    },
  };
}

export const workroomDriveScheduled = jobs.createFunction(
  {
    id: WORKROOM_DRIVE_INNGEST_ID,
    retries: 1,
    concurrency: [{ limit: 1 }],
    triggers: [cron(WORKROOM_DRIVE_CRON)],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, WORKROOM_DRIVE_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("workroom-drive", () => runWorkroomDriveJob());
  },
);

export const workroomDriveRunNow = jobs.createFunction(
  {
    id: WORKROOM_DRIVE_RUN_NOW_INNGEST_ID,
    retries: 0,
    concurrency: [{ limit: 1 }],
    triggers: [{ event: WORKROOM_DRIVE_REQUESTED_EVENT }],
  },
  async ({ step }) => {
    const gate = await gateAtEntry(step, WORKROOM_DRIVE_RUN_NOW_INNGEST_ID);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("workroom-drive", () => runWorkroomDriveJob());
  },
);
