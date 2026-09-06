// apps/web/lib/queue/functions/workroom-drive.ts
//
// BI-FCD639D9 — the standing Workroom drive. DPF owns wake, lease, dispatch,
// attention, and stop. Codex/Claude/Grok/embedded coworkers are interchangeable
// workers behind ScheduledAgentTask. Quiet rooms do not wake.
//
// Mirrors obligation-assurance-watch.ts: pure exported job + thin Inngest
// wrappers behind gateAtEntry.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import {
  COORDINATION_RESOURCE_TYPE,
  COORDINATION_SCOPE_TYPE,
  jsiSchemePresent,
  resolveCoordinatorEligibility,
} from "@/lib/work-management/coordinator-eligibility";
import { planCoordinationBindings } from "@/lib/authority/coordination-bindings";
import { planContainmentRelations } from "@/lib/work-management/standing-room-nesting";

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
  resolveDrivePlan,
  workroomDriveTaskId,
  type DrivePlan,
} from "@/lib/work-management/drive-resolution";
import type { WorkroomCoordinatorEligibility } from "@/lib/work-management/workroom-shape-conformance";
import { readStoredWorkroomDriveState } from "@/lib/work-management/workroom-drive-state";

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
  receipts: { stageKey: string; kind: string }[];
  budgetUsage: { kind: string; used: number }[];
  stopConditionHits: string[];
  reviewDue: boolean;
  substrateReachable: boolean;
  substrateEmpty: boolean;
  /** Current verifier-readable JSI and TAK eligibility for an AI coordinator. */
  coordinatorEligibility?: WorkroomCoordinatorEligibility | null;
};

export type WorkroomDriveEffects = {
  persist: (input: {
    roomId: string;
    snapshot: Record<string, unknown>;
    activityKind: string;
    summary: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
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
    now: Date;
  }) => Promise<void>;
  deactivateAgentTask: (taskId: string) => Promise<void>;
};

export type WorkroomDriveResult = {
  runId: string;
  scanned: number;
  dispatched: number;
  attention: number;
  stopped: number;
  skipped: number;
  /** `contains` relations materialized this tick from the declared standing-room
   *  tree. Non-zero only while the estate is catching up; a settled estate reports
   *  0 forever, which is how an operator tells "nesting is done" from "nesting was
   *  never written" (BI-AEAA90A9). */
  nestedRelations: number;
  plans: Array<{ roomId: string; action: string; reason: string; taskId: string | null }>;
};

const TERMINAL = new Set(["abandoned", "archived", "complete"]);

/** Max rooms one drive tick will consider. Bounds CANDIDATES, not all rooms. */
export const STANDING_ROOM_SCAN_LIMIT = 200;

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

export async function applyDrivePlan(input: {
  room: WorkroomDriveRoom;
  plan: DrivePlan;
  now: Date;
  effects: WorkroomDriveEffects;
}): Promise<"dispatched" | "attention" | "stopped" | "skipped"> {
  const { room, plan, now, effects } = input;
  const snapshot = {
    kind: "workroom-drive",
    version: 1,
    action: plan.action,
    reason: plan.reason,
    stageKey: plan.stageKey,
    taskId: plan.taskId,
    lastRunAt: now.toISOString(),
    lastCycleKey: plan.cycle?.cycleKey ?? null,
    receipts: room.receipts,
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
  };

  if (plan.action === "do_not_wake") {
    if (plan.shapeKey) {
      await effects.deactivateAgentTask(workroomDriveTaskId(room.capsuleId, plan.shapeKey));
    }
    await effects.persist({
      roomId: room.id,
      snapshot,
      activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
      summary: `Drive did not wake: ${plan.reason}`,
      payload: snapshot,
    });
    return "skipped";
  }

  if (plan.action === "attention") {
    await effects.persist({
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
    const lease = await effects.acquireLease({
      roomId: room.id,
      now,
      holderPrincipalId: room.leaseHolderPrincipalId,
      expiresAt: new Date(now.getTime() + WORKROOM_DRIVE_LEASE_MS),
      currentExpiresAt: room.leaseExpiresAt,
      currentHolder: room.leaseHolderPrincipalId,
    });
    if (lease === "held") {
      await effects.persist({
        roomId: room.id,
        snapshot: { ...snapshot, reason: "lease_held" },
        activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
        summary: "Drive lease held by another worker; stage remains eligible when it expires.",
        payload: { ...snapshot, reason: "lease_held" },
      });
      return "skipped";
    }
    if (!room.ownerUserId) {
      await effects.persist({
        roomId: room.id,
        snapshot: { ...snapshot, reason: "missing_task_owner" },
        activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
        summary: "Agent stage is eligible but no owner user is bound for ScheduledAgentTask.",
        payload: snapshot,
      });
      return "skipped";
    }
    await effects.upsertAgentTask({
      taskId: plan.taskId,
      agentId: plan.agentId,
      ownerUserId: room.ownerUserId,
      title: `Workroom ${room.capsuleId} / ${plan.stageKey}`,
      prompt: `Execute Workroom ${room.capsuleId} stage ${plan.stageKey} for shape ${plan.shapeKey}@${plan.shapeVersion}. Stay inside the declared grants. Do not skip stages, widen authority, or invent occupants.`,
      now,
    });
    await effects.persist({
      roomId: room.id,
      snapshot,
      activityKind: WORKROOM_DRIVE_ACTIVITY_KIND,
      summary: `Dispatched ${plan.taskId} for stage ${plan.stageKey}`,
      payload: snapshot,
    });
    return "dispatched";
  }

  await effects.persist({
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
  }
  const effects = deps?.effects ?? liveEffects();
  const plans: WorkroomDriveResult["plans"] = [];
  let dispatched = 0;
  let attention = 0;
  let stopped = 0;
  let skipped = 0;

  for (const room of rooms) {
    const shape = resolveWorkShapeClaim(room.scopeClaims);
    const stored = readStoredWorkroomDriveState(room.workspaceState);
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
      receipts: room.receipts.length > 0 ? room.receipts : stored.receipts,
      budgetUsage: room.budgetUsage.length > 0 ? room.budgetUsage : stored.budgetUsage,
      stopConditionHits: room.stopConditionHits.length > 0 ? room.stopConditionHits : stored.stopConditionHits,
      reviewDue: room.reviewDue || stored.reviewDue,
      substrateReachable: room.substrateReachable,
      substrateEmpty: room.substrateEmpty,
      coordinatorEligibility: room.coordinatorEligibility,
      now,
    });
    plans.push({
      roomId: room.capsuleId,
      action: plan.action,
      reason: plan.reason,
      taskId: plan.taskId,
    });
    const outcome = await applyDrivePlan({ room, plan, now, effects });
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

/**
 * Ids of the rooms the drive could possibly act on: non-terminal, not archived,
 * and actually carrying a work-shape claim.
 *
 * The claim lives inside the `scopeClaims` JSON, which Prisma cannot filter on
 * for an array of objects — so this is raw SQL rather than a `findMany` where
 * clause. That matters more than it looks: the previous implementation capped
 * `findMany` at 200 rows and only then filtered for the claim in JavaScript, so
 * the cap applied to ALL rooms rather than to candidates. On the reference
 * install that meant 276 non-terminal rooms, exactly one of them shaped, and a
 * drive that reported `scanned: 0` forever because the one shaped room fell
 * outside an unordered 200-row window. Filtering in SQL means the cap now
 * bounds work the drive can actually do, and `ORDER BY` makes which rooms it
 * takes deterministic instead of whatever the planner returned.
 */
export async function loadStandingRoomIds(db: {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<Array<{ id: string }>>;
}): Promise<string[]> {
  const rows = await db.$queryRaw`
    SELECT "id"
    FROM "WorkCapsule"
    WHERE "archivedAt" IS NULL
      AND "status" NOT IN ('abandoned', 'archived', 'complete')
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements("scopeClaims") AS claim
        WHERE claim ? 'workShape'
      )
    ORDER BY "updatedAt" ASC, "id" ASC
    LIMIT ${STANDING_ROOM_SCAN_LIMIT}
  `;
  return rows.map((row) => row.id);
}

/**
 * Write the declared standing-room tree, returning how many relations were newly
 * created. Idempotent: the (from, to, relation) unique constraint plus
 * skipDuplicates means a settled estate writes nothing and reports 0.
 *
 * Failure is non-fatal. Nesting is what the hierarchy is built on, but a room
 * that can still be driven must not be blocked because its parent link could not
 * be written this minute.
 */
export async function reconcileStandingRoomNesting(): Promise<number> {
  try {
    const { prisma } = await import("@dpf/db");
    const rooms = await prisma.workroom.findMany({
      where: { archivedAt: null, idempotencyKey: { startsWith: "standing-room:" } },
      select: { id: true, capsuleId: true, idempotencyKey: true },
    });
    const byCapsuleId = new Map(rooms.map((room) => [room.capsuleId, room.id]));
    const plans = planContainmentRelations(
      rooms.map((room) => ({ capsuleId: room.capsuleId, idempotencyKey: room.idempotencyKey })),
    );
    if (plans.length === 0) return 0;
    const created = await prisma.workroomRelation.createMany({
      data: plans.flatMap((plan) => {
        const fromWorkroomId = byCapsuleId.get(plan.fromCapsuleId);
        const toWorkroomId = byCapsuleId.get(plan.toCapsuleId);
        return fromWorkroomId && toWorkroomId
          ? [{ fromWorkroomId, toWorkroomId, relation: "contains" as const }]
          : [];
      }),
      skipDuplicates: true,
    });
    return created.count;
  } catch {
    return 0;
  }
}

/**
 * Coordination bindings, keyed by the shape they grant coordination over.
 *
 * One query for the whole tick rather than one per room: the binding set is
 * small (a row per shape the install staffs) and the drive reads every standing
 * room on every pass.
 */
/**
 * Materialize coordination authority for the shapes this install ships.
 *
 * Idempotent by derivable bindingId: an existing binding is left exactly as the
 * operator has it — including SUSPENDED. Re-seeding must never silently
 * re-grant authority a human deliberately withdrew, which is the one way this
 * could become an authority-laundering path rather than a grant.
 *
 * Returns how many were newly created; a settled install reports 0.
 */
export async function reconcileCoordinationBindings(): Promise<number> {
  try {
    const { prisma } = await import("@dpf/db");
    const plans = planCoordinationBindings();
    if (plans.length === 0) return 0;
    const existing = await prisma.authorityBinding.findMany({
      where: { bindingId: { in: plans.map((plan) => plan.bindingId) } },
      select: { bindingId: true },
    });
    const known = new Set(existing.map((row) => row.bindingId));
    const missing = plans.filter((plan) => !known.has(plan.bindingId));
    if (missing.length === 0) return 0;
    let created = 0;
    for (const plan of missing) {
      const agent = await prisma.principal.findFirst({
        where: { kind: "agent", principalId: plan.agentId },
        select: { id: true, principalId: true },
      });
      await prisma.authorityBinding.create({
        data: {
          bindingId: plan.bindingId,
          name: plan.name,
          scopeType: plan.scopeType,
          resourceType: plan.resourceType,
          resourceRef: plan.resourceRef,
          status: plan.status,
          approvalMode: plan.approvalMode,
          appliedAgentId: agent?.id ?? null,
          subjects: {
            create: plan.subjects.map((subject) => ({
              subjectType: subject.subjectType,
              subjectRef: subject.subjectRef,
              relation: subject.relation,
            })),
          },
        },
      });
      created += 1;
    }
    return created;
  } catch {
    // Never take the drive down over a seeding failure; rooms then read "absent"
    // and refuse, which is the safe pre-existing behaviour.
    return 0;
  }
}

async function loadCoordinationBindings(): Promise<
  Map<string, Array<{ status: string; scopeType: string; resourceType: string; resourceRef: string }>>
> {
  const byShape = new Map<
    string,
    Array<{ status: string; scopeType: string; resourceType: string; resourceRef: string }>
  >();
  try {
    const { prisma } = await import("@dpf/db");
    const rows = await prisma.authorityBinding.findMany({
      where: { scopeType: COORDINATION_SCOPE_TYPE, resourceType: COORDINATION_RESOURCE_TYPE },
      select: { status: true, scopeType: true, resourceType: true, resourceRef: true },
    });
    for (const row of rows) {
      const bucket = byShape.get(row.resourceRef);
      if (bucket) bucket.push(row);
      else byShape.set(row.resourceRef, [row]);
    }
  } catch {
    // A binding lookup that fails must not take the drive down. Rooms then read
    // "unknown" and refuse, which is the pre-existing safe behaviour.
  }
  return byShape;
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
      createdByPrincipal: {
        select: {
          aliases: {
            where: { aliasType: "user", issuer: "" },
            select: { aliasValue: true },
            take: 1,
          },
        },
      },
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
      ownerUserId: row.createdByPrincipal?.aliases[0]?.aliasValue ?? null,
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

function liveEffects(): WorkroomDriveEffects {
  return {
    async persist(input) {
      const { prisma } = await import("@dpf/db");
      const current = await prisma.workroom.findUnique({
        where: { id: input.roomId },
        select: { workspaceState: true },
      });
      const existing = asRecord(current?.workspaceState) ?? {};
      await prisma.workroom.update({
        where: { id: input.roomId },
        data: { workspaceState: { ...existing, workroomDrive: input.snapshot } as object },
      });
      const activity = await prisma.workroomActivity.create({
        data: {
          workCapsuleId: input.roomId,
          kind: input.activityKind,
          summary: input.summary,
          payload: input.payload as object,
        },
      });
      const { publishRecordedWorkCapsuleActivity } = await import("@/lib/work-capsules/activity-events");
      publishRecordedWorkCapsuleActivity(input.roomId, activity.id);
    },
    async acquireLease(input) {
      if (input.currentExpiresAt && input.currentExpiresAt.getTime() > input.now.getTime()) {
        return "held";
      }
      const { prisma } = await import("@dpf/db");
      await prisma.workroom.update({
        where: { id: input.roomId },
        data: {
          leaseExpiresAt: input.expiresAt,
          leaseHolderPrincipalId: input.holderPrincipalId,
        },
      });
      return "acquired";
    },
    async upsertAgentTask(input) {
      const { prisma } = await import("@dpf/db");
      await prisma.scheduledAgentTask.upsert({
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
        },
        update: {
          agentId: input.agentId,
          title: input.title,
          prompt: input.prompt,
          nextRunAt: input.now,
          isActive: true,
        },
      });
    },
    async deactivateAgentTask(taskId) {
      const { prisma } = await import("@dpf/db");
      await prisma.scheduledAgentTask.updateMany({
        where: { taskId },
        data: { isActive: false },
      });
    },
  };
}

export const workroomDriveScheduled = inngest.createFunction(
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

export const workroomDriveRunNow = inngest.createFunction(
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
