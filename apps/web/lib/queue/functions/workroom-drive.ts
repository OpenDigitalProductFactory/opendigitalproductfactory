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
  plans: Array<{ roomId: string; action: string; reason: string; taskId: string | null }>;
};

const TERMINAL = new Set(["abandoned", "archived", "complete"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStoredDrive(workspaceState: unknown): {
  currentStageKey: string | null;
  receipts: { stageKey: string; kind: string }[];
  budgetUsage: { kind: string; used: number }[];
  stopConditionHits: string[];
  reviewDue: boolean;
} {
  const drive = asRecord(asRecord(workspaceState)?.workroomDrive);
  const receipts = Array.isArray(drive?.receipts)
    ? drive.receipts.filter((entry): entry is { stageKey: string; kind: string } => {
      const row = asRecord(entry);
      return Boolean(row && typeof row.stageKey === "string" && typeof row.kind === "string");
    })
    : [];
  const budgetUsage = Array.isArray(drive?.budgetUsage)
    ? drive.budgetUsage.filter((entry): entry is { kind: string; used: number } => {
      const row = asRecord(entry);
      return Boolean(row && typeof row.kind === "string" && typeof row.used === "number");
    })
    : [];
  const stopConditionHits = Array.isArray(drive?.stopConditionHits)
    ? drive.stopConditionHits.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    currentStageKey: typeof drive?.stageKey === "string" ? drive.stageKey : null,
    receipts,
    budgetUsage,
    stopConditionHits,
    reviewDue: drive?.reviewDue === true,
  };
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
  },
): Promise<WorkroomDriveResult> {
  const rooms = deps?.listRooms ? await deps.listRooms() : await loadStandingRooms();
  const effects = deps?.effects ?? liveEffects();
  const plans: WorkroomDriveResult["plans"] = [];
  let dispatched = 0;
  let attention = 0;
  let stopped = 0;
  let skipped = 0;

  for (const room of rooms) {
    const shape = resolveWorkShapeClaim(room.scopeClaims);
    const stored = readStoredDrive(room.workspaceState);
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

  return {
    runId: `workroom-drive:${now.toISOString()}`,
    scanned: rooms.length,
    dispatched,
    attention,
    stopped,
    skipped,
    plans,
  };
}

async function loadStandingRooms(): Promise<WorkroomDriveRoom[]> {
  const { prisma } = await import("@dpf/db");
  const rows = await prisma.workroom.findMany({
    where: {
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
    take: 200,
  });

  return rows.flatMap((row) => {
    if (!resolveWorkShapeClaim(row.scopeClaims)) return [];
    return [{
      id: row.id,
      capsuleId: row.capsuleId,
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
      ...readStoredDrive(row.workspaceState),
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
      await prisma.workroomActivity.create({
        data: {
          workCapsuleId: input.roomId,
          kind: input.activityKind,
          summary: input.summary,
          payload: input.payload as object,
        },
      });
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
    const gate = await gateAtEntry(step);
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
    const gate = await gateAtEntry(step);
    if (!gate.proceed) return { skipped: true, reason: gate.reason };
    return step.run("workroom-drive", () => runWorkroomDriveJob());
  },
);
