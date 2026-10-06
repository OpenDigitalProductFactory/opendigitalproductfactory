// apps/web/lib/queue/functions/workroom-drive.ts
//
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
import type { Prisma, PrismaClient } from "@dpf/db";
import { jobs } from "@/lib/jobs";
import {
  jsiSchemePresent,
  resolveCoordinatorEligibility,
} from "@/lib/work-management/coordinator-eligibility";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";
import { buildStageBrief, stageBriefInputFromDefinition, stageEvidenceKinds } from "@/lib/work-management/stage-briefing";
import { withWorkroomStageTaskConfig, type WorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
import { driveTickIsNews, nextDriveHold, readDriveHold, stallNoticeDue, type WorkroomDriveHold } from "@/lib/work-management/workroom-drive-hold";

import {
  loadCoordinationBindings,
  loadRecordedEvidence,
  loadStageDispatchTimes,
  loadStageDispatchTimesByStage,
  loadStandingRoomIds,
  reconcileCoordinationBindings,
  reconcileStandingRoomNesting,
} from "./workroom-drive-data";
export { loadStandingRoomIds, STANDING_ROOM_SCAN_LIMIT } from "./workroom-drive-data";
import { earnGraphReceipts, graphSnapshotFields, hasStoredDriveMarking } from "@/lib/work-management/drive-graph-tick";
import { earnEvidenceReceipts, type RecordedEvidence } from "@/lib/work-management/stage-evidence-receipts";

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
import { resolveWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
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
export { mergeWorkroomDriveSnapshot } from "@/lib/work-management/workroom-drive-snapshot-merge";
import { repairUnownedDeliveryRooms, ROOM_OWNER_USER_INCLUDE, roomOwnerUserId } from "@/lib/work-management/delivery-room-ownership";

export type WorkroomDriveRoom = {
  id: string;
  capsuleId: string;
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
  /** Stage-scoped evidence recorded through record_workroom_evidence — the only
   *  thing a completing receipt is earned from (BI-76B35820). */
  recordedEvidence?: RecordedEvidence[];
  /** When the current stage was most recently dispatched. */
  stageDispatchedAt?: Date | null;
  /** Graph rooms only (Phase 3c): when each marked stage most recently started. */
  stageDispatchedAtByStage?: ReadonlyMap<string, Date> | null;
  budgetUsage: { kind: string; used: number }[];
  stopConditionHits: string[];
  reviewDue: boolean;
  substrateReachable: boolean;
  substrateEmpty: boolean;
  /** Current verifier-readable JSI and TAK eligibility for an AI coordinator. */
  coordinatorEligibility?: WorkroomCoordinatorEligibility | null;
};

export type WorkroomDriveEffects = {
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
    title: string;
    prompt: string;
    /** Stage + declared tools, written to taskConfig.workroomStage for the scheduler's pin (BI-43C3E914). */
    stage: WorkroomStageTaskConfig;
    now: Date;
    lease: { roomId: string; expiresAt: Date; holderPrincipalId: string | null };
  }) => Promise<boolean>;
  deactivateAgentTask: (taskId: string) => Promise<void>;
};

export type WorkroomDriveResult = {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function postureLevelOf(scopeClaims: unknown): ProactivityLevel | null {
  const declared = readWorkroomPostureClaim(scopeClaims)?.proactivityLevel;
  if (declared === "quiet" || declared === "balanced" || declared === "assertive") return declared;
  return "balanced";
}

/**
 * The answer when nobody was asked, because the tick did not need an owner.
 * Never reaches a recorded blockage: driveOutcomeNeedsOwner gates the call.
 */
const NOT_ASKED_ACCOUNTABILITY: EffectiveHumanAccountability = {
  state: "setup-required",
  reason: "no-organization-owner-recorded",
  message: "Accountability was not resolved because this tick needed no owner.",
  atWorkroomId: null,
};

async function resolveAccountabilityForConclusion(
  roomId: string,
  effects: WorkroomDriveEffects,
): Promise<EffectiveHumanAccountability> {
  if (!effects.resolveAccountability) {
    return {
      state: "setup-required",
      reason: "no-organization-owner-recorded",
      message:
        "This drive was composed without an accountability resolver, so no owner could be named. "
        + "Wire resolveAccountability into the drive's effects.",
      atWorkroomId: roomId,
    };
  }
  try {
    return await effects.resolveAccountability(roomId);
  } catch (error) {
    // A failed lookup must not swallow the blockage. Record that the owner is
    // unknown and why, which is still louder than stopping silently.
    return {
      state: "setup-required",
      reason: "no-organization-owner-recorded",
      message: `Accountability could not be read: ${error instanceof Error ? error.message : String(error)}`,
      atWorkroomId: roomId,
    };
  }
}

export async function applyDrivePlan(input: {
  room: WorkroomDriveRoom;
  plan: DrivePlan;
  now: Date;
  effects: WorkroomDriveEffects;
}): Promise<"dispatched" | "attention" | "stopped" | "skipped"> {
  const { room, plan, now, effects } = input;
  const receipts = [...room.receipts];
  if (
    plan.reason === EXECUTOR_WRITEBACK_UNAVAILABLE_REASON
    && plan.stageKey
    && !receipts.some((receipt) =>
      receipt.stageKey === plan.stageKey && receipt.kind === WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND
    )
  ) {
    receipts.push({ stageKey: plan.stageKey, kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND });
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
    ? await resolveAccountabilityForConclusion(room.id, effects)
    : NOT_ASKED_ACCOUNTABILITY;
  const conclusion = resolveDriveConclusion({
    action: plan.action,
    reason: plan.reason,
    attentionPrincipalRef: plan.attentionPrincipalRef,
    accountability,
  });

  const priorHold = readDriveHold(room.workspaceState);
  // Graph shapes only (Phase 3c): marking carry-forward and the marked keys. Null for every sequential room.
  const graph = graphSnapshotFields(plan, room.workspaceState);
  const hold = nextDriveHold(priorHold, { action: plan.action, reason: plan.reason, stageKey: plan.stageKey, conformance: plan.conformance,
    ...(graph?.markedKeys ? { markedKeys: graph.markedKeys } : {}) }, now);
  if (stallNoticeDue(hold) && effects.notifyStall) {
    await effects.notifyStall({ room, hold, reason: plan.reason, conformance: plan.conformance })
      .then(() => { hold.notifiedAt = now.toISOString(); }, () => undefined);
  }
  const quiet = !driveTickIsNews(priorHold, hold, plan.action, graph?.iterationChanged);
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
    ...graph?.fields,
  };

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
    if (!room.ownerUserId) {
      await persist({
        roomId: room.id,
        snapshot: { ...snapshot, reason: "missing_task_owner" satisfies DriveReasonFor<"dispatch_agent"> },
        activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
        summary: "Agent stage is eligible but no owner user is bound for ScheduledAgentTask.",
        payload: { ...snapshot, reason: "missing_task_owner" satisfies DriveReasonFor<"dispatch_agent"> },
      });
      return "skipped";
    }
    // GPP element 2 "Attachment" + element 5 "Capability set": the brief and the
    // task carry the stage's declared tools; the scheduler pins them (BI-43C3E914).
    const brief = stageBriefInputFromDefinition({ capsuleId: room.capsuleId, roomObjective: room.objective ?? null,
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
      now,
      lease: { roomId: room.id, expiresAt, holderPrincipalId: room.leaseHolderPrincipalId },
    });
    if (!scheduled) return "skipped";
    await persist({
      roomId: room.id,
      snapshot,
      activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
      summary: `Dispatched ${plan.taskId} for stage ${plan.stageKey}`,
      payload: snapshot,
      lease: { expiresAt, holderPrincipalId: room.leaseHolderPrincipalId },
    });
    return "dispatched";
  }

  await persist({
    roomId: room.id,
    snapshot,
    activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
    summary: `Drive ${plan.action}: ${plan.reason}`,
    payload: snapshot,
  });
  if (plan.shapeKey) {
    await effects.deactivateAgentTask(workroomDriveTaskId(room.capsuleId, plan.shapeKey));
  }
  return plan.action === "stop" ? "stopped" : "skipped";
}

export async function runWorkroomDriveJob(
  now: Date = new Date(),
  deps?: {
    listRooms?: () => Promise<WorkroomDriveRoom[]>;
    effects?: WorkroomDriveEffects;
    reconcileNotifications?: () => Promise<void>;
    reconcileNesting?: () => Promise<number>;
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
    await reconcileCoordinationBindings();
    const { prisma } = await import("@dpf/db");
    const [bindings, schemePresent] = [
      await loadCoordinationBindings(),
      jsiSchemePresent(prisma as unknown as Record<string, unknown>),
    ];
    rooms = await loadStandingRooms(bindings, schemePresent);
    // Stage-scoped evidence is the ONLY thing a completing receipt is earned
    // from, so a room that arrives without it can never advance.
    const evidenceByRoom = await loadRecordedEvidence(rooms.map((room) => room.capsuleId));
    const dispatchByRoom = await loadStageDispatchTimes(rooms.map((room) => room.capsuleId));
    const dispatchByStage = await loadStageDispatchTimesByStage(
      rooms.filter((room) => hasStoredDriveMarking(room.workspaceState)).map((room) => room.capsuleId));
    rooms = rooms.map((room) => ({
      ...room,
      recordedEvidence: evidenceByRoom.get(room.capsuleId) ?? [],
      stageDispatchedAt: dispatchByRoom.get(room.capsuleId) ?? null,
      ...(dispatchByStage.has(room.capsuleId) ? { stageDispatchedAtByStage: dispatchByStage.get(room.capsuleId) } : {}),
    }));
  }
  const effects = deps?.effects ?? createWorkroomDriveEffects();
  const plans: WorkroomDriveResult["plans"] = [];
  let dispatched = 0;
  let attention = 0;
  let stopped = 0;
  let skipped = 0;

  for (const room of rooms) {
    const shape = resolveWorkShapeClaim(room.scopeClaims);
    const stored = readStoredWorkroomDriveState(room.workspaceState);
    const receipts = (earnGraphReceipts({ definition: shape ? readWorkShapeDefinitionContract(shape) : null, workspaceState: room.workspaceState,
      evidence: room.recordedEvidence ?? [], dispatchedAtByStage: room.stageDispatchedAtByStage, existing: room.receipts.length > 0 ? room.receipts : stored.receipts,
    }) ?? earnEvidenceReceipts({
      stageKey: room.currentStageKey ?? stored.currentStageKey,
      declaredKinds: stageEvidenceKinds(shape ? readWorkShapeDefinitionContract(shape) : null, room.currentStageKey ?? stored.currentStageKey),
      evidence: room.recordedEvidence ?? [],
      dispatchedAt: room.stageDispatchedAt ?? null,
      existing: room.receipts.length > 0 ? room.receipts : stored.receipts,
    })) as { stageKey: string; kind: string; iteration?: number }[];
    const plan = resolveDrivePlan({
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
      workspaceState: room.workspaceState,
    });
    plans.push({
      roomId: room.capsuleId,
      action: plan.action,
      reason: plan.reason,
      taskId: plan.taskId,
    });
    const outcome = await applyDrivePlan({ room: { ...room, receipts }, plan, now, effects });
    if (outcome === "dispatched") dispatched += 1;
    else if (outcome === "attention") attention += 1;
    else if (outcome === "stopped") stopped += 1;
    else skipped += 1;
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
    plans,
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

  return rows.flatMap((row) => {
    const shapeRef = resolveWorkShapeClaim(row.scopeClaims);
    if (!shapeRef) return [];
    // Authority is granted over the shape, not one of its revisions.
    const shapeKey = shapeRef.key;
    return [{
      id: row.id,
      capsuleId: row.capsuleId,
      coordinatorEligibility: resolveCoordinatorEligibility({
        shapeKey,
        bindings: (shapeKey ? coordinationBindings?.get(shapeKey) : undefined) ?? [],
        schemePresent,
      }),
      scopeClaims: row.scopeClaims,
      workspaceState: row.workspaceState,
      leaseExpiresAt: row.leaseExpiresAt,
      leaseHolderPrincipalId: row.leaseHolderPrincipalId,
      ownerUserId: roomOwnerUserId(row),
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
    // BI-12A083B4: the drive asks this only when a tick ends stuck, so a
    // blockage can name who clears it instead of waiting on nobody. Composed
    // from the same lineage walk the room workforce read uses, so the two
    // cannot disagree about who answers for a room.
    async resolveAccountability(roomId) {
      const prisma = await loadDb();
      const { resolveRoomAccountabilityFromDb } = await import(
        "@/lib/work-management/room-workforce.server"
      );
      return resolveRoomAccountabilityFromDb(
        prisma as unknown as Parameters<typeof resolveRoomAccountabilityFromDb>[0],
        { workroomId: roomId },
      );
    },
    notifyStall: async (input) => (await import("@/lib/work-management/workroom-stall-notice")).notifyWorkroomStall(input),
    async persist(input) {
      const prisma = await loadDb();
      const activity = await prisma.$transaction(async (tx) => {
        if (!input.observationOnly) {
          const current = await tx.workroom.findUnique({
            where: { id: input.roomId },
            select: { workspaceState: true, updatedAt: true },
          });
          if (!current) return null;
          const snapshot = mergeWorkroomDriveSnapshot(current.workspaceState, input.snapshot, { graphShape: input.graphShape });
          const updated = await tx.workroom.updateMany({
            where: {
              id: input.roomId, updatedAt: current.updatedAt, archivedAt: null, status: { notIn: [...TERMINAL] },
              ...(input.lease ? {
                leaseExpiresAt: input.lease.expiresAt, leaseHolderPrincipalId: input.lease.holderPrincipalId,
                AND: [{ leaseExpiresAt: { gt: clock() } }],
              } : {}),
            },
            data: { workspaceState: { ...asRecord(current.workspaceState), workroomDrive: snapshot } as object },
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
      return prisma.$transaction(async (tx) => {
        // Lock the room through the scheduling write. An expired or superseded
        // driver cannot reactivate a task after another owner takes over.
        const owned = await tx.workroom.updateMany({
          where: {
            id: input.lease.roomId, archivedAt: null, status: { notIn: [...TERMINAL] },
            leaseExpiresAt: input.lease.expiresAt,
            leaseHolderPrincipalId: input.lease.holderPrincipalId,
            AND: [{ leaseExpiresAt: { gt: clock() } }],
          },
          data: { leaseExpiresAt: input.lease.expiresAt },
        });
        if (owned.count !== 1) return false;
        // Merge, never replace: taskConfig is shared JSON; only workroomStage is this writer's.
        const current = await tx.scheduledAgentTask.findUnique({ where: { taskId: input.taskId }, select: { taskConfig: true } });
        const taskConfig = withWorkroomStageTaskConfig(current?.taskConfig ?? null, input.stage) as Prisma.InputJsonValue;
        await tx.scheduledAgentTask.upsert({
          where: { taskId: input.taskId },
          create: {
            taskId: input.taskId,
            agentId: input.agentId,
            title: input.title,
            prompt: input.prompt,
            routeContext: "/ops/workrooms",
            schedule: WORKROOM_DRIVE_CRON,
            timezone: "UTC",
            ownerUserId: input.ownerUserId,
            nextRunAt: input.now,
            isActive: true,
            taskConfig,
          },
          update: {
            agentId: input.agentId,
            title: input.title,
            prompt: input.prompt,
            taskConfig,
            nextRunAt: input.now,
            isActive: true,
          },
        });
        return true;
      });
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
