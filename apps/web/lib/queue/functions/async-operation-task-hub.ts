import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";

import { resolveOperatorRecipient } from "@/lib/attention/notify-live";
import { parseAsyncInferenceOperationStatus } from "@/lib/inference/async-operation-contract";
import { ASYNC_OPERATION_TRANSITION_EVENT } from "@/lib/inference/async-operation-outbox";
import { publishWorkCapsuleActivityEvent } from "@/lib/work-capsules/activity-events";
import { notifyDeliveryCandidateLive } from "@/lib/work-capsules/delivery-task-notifications-live";
import type {
  DeliveryNotificationCandidate,
  DeliveryNotificationKind,
} from "@/lib/work-capsules/delivery-task-notifications";
import { isDeliveryNotificationTransitionRecent } from "@/lib/work-capsules/delivery-task-notifications";
import { inngest } from "../inngest-client";

type WorkroomProjection = {
  id: string;
  capsuleId: string;
  title: string;
  archivedAt: Date | null;
  taskRun?: { userId: string } | null;
};

type CanonicalTransition = {
  id: string;
  sequence: number;
  status: unknown;
  occurredAt: Date;
  operation: {
    id: string;
    identityVersion: number;
    taskRunId: string | null;
    workroomId: string | null;
    workroom: WorkroomProjection | null;
    taskRun: null | {
      taskRunId: string;
      userId: string;
      workrooms: WorkroomProjection[];
    };
  };
};

type ActivityProjection = {
  id: string;
  workroomId: string;
  kind: "status-changed";
  summary: string;
  payload: { status: string; sequence: number };
  recordedAt: Date;
};

type DeliveryDependencies = {
  loadTransition(input: { operationId: string; sequence: number }): Promise<CanonicalTransition | null>;
  recordActivity(input: ActivityProjection): Promise<void>;
  publishActivity(input: { workroomId: string; activityId: string }): Promise<boolean>;
  resolveOperatorUserId(): Promise<string | null>;
  notify(input: DeliveryNotificationCandidate & { userId: string }): Promise<{ created: boolean }>;
  now(): Date;
};

type TransitionLocator = {
  operationId?: unknown;
  sequence?: unknown;
  status?: unknown;
  checkpoint?: unknown;
  occurredAt?: unknown;
};

function requiredLocator(input: TransitionLocator): { operationId: string; sequence: number } {
  if (typeof input.operationId !== "string" || !input.operationId.trim()) {
    throw new Error("ASYNC_OPERATION_TRANSITION_OPERATION_ID_REQUIRED");
  }
  if (typeof input.sequence !== "number" || !Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    throw new Error("ASYNC_OPERATION_TRANSITION_SEQUENCE_INVALID");
  }
  return { operationId: input.operationId, sequence: input.sequence };
}

function activityId(operationId: string, sequence: number): string {
  const digest = createHash("sha256")
    .update(`dpf:async-operation-workroom-activity:v1\0${operationId}\0${sequence}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `wca_async_${digest}`;
}

function activitySummary(status: string): string {
  const summaries: Record<string, string> = {
    pending: "Async operation admitted.",
    start_indeterminate: "Async operation start requires reconciliation.",
    running: "Async operation is running.",
    completed: "Async operation completed.",
    failed: "Async operation failed.",
    cancelled: "Async operation was cancelled.",
    expired: "Async operation expired.",
  };
  return summaries[status] ?? "Async operation transitioned.";
}

function notificationFor(
  status: string,
  room: WorkroomProjection,
  sourceKey: string,
): DeliveryNotificationCandidate | null {
  const definitions: Partial<Record<string, {
    kind: DeliveryNotificationKind;
    body: string;
    fragment: "activity" | "result";
  }>> = {
    completed: {
      kind: "completed",
      body: "The durable async operation completed. Open the Workroom to review its result.",
      fragment: "result",
    },
    failed: {
      kind: "failed",
      body: "The durable async operation failed and needs attention.",
      fragment: "activity",
    },
    expired: {
      kind: "expired",
      body: "The durable async operation expired before completion and needs attention.",
      fragment: "activity",
    },
    start_indeterminate: {
      kind: "reconciliation-required",
      body: "The durable async operation start is indeterminate and needs reconciliation.",
      fragment: "activity",
    },
  };
  const selected = definitions[status];
  return selected ? {
    capsuleId: room.capsuleId,
    title: room.title,
    kind: selected.kind,
    sourceKey,
    body: selected.body,
    deepLink: `/build/work/${encodeURIComponent(room.capsuleId)}#${selected.fragment}`,
  } : null;
}

function resolveWorkroom(transition: CanonicalTransition): {
  room: WorkroomProjection | null;
  reason?: string;
} {
  const operation = transition.operation;
  if (operation.workroomId) {
    if (operation.taskRunId || !operation.workroom || operation.workroom.archivedAt) {
      return { room: null, reason: "invalid-workroom-binding" };
    }
    return { room: operation.workroom };
  }
  if (!operation.taskRunId || !operation.taskRun) {
    return { room: null, reason: "missing-authority-binding" };
  }
  if (operation.taskRun.workrooms.length > 1) {
    return { room: null, reason: "ambiguous-task-run-workroom" };
  }
  const room = operation.taskRun.workrooms[0] ?? null;
  return room ? { room } : { room: null, reason: "task-run-workroom-not-found" };
}

export async function deliverAsyncOperationTransition(
  eventData: TransitionLocator,
  dependencies: DeliveryDependencies,
): Promise<{ matched: boolean; delivered: number; notified: number; reason?: string }> {
  const locator = requiredLocator(eventData);
  const transition = await dependencies.loadTransition(locator);
  if (!transition) return { matched: false, delivered: 0, notified: 0, reason: "transition-not-found" };
  if (transition.operation.identityVersion !== 1) {
    return { matched: true, delivered: 0, notified: 0, reason: "legacy-operation" };
  }
  const status = parseAsyncInferenceOperationStatus(transition.status);
  const resolved = resolveWorkroom(transition);
  if (!resolved.room) {
    return { matched: true, delivered: 0, notified: 0, reason: resolved.reason };
  }

  const room = resolved.room;
  const projectedActivityId = activityId(transition.operation.id, transition.sequence);
  await dependencies.recordActivity({
    id: projectedActivityId,
    workroomId: room.id,
    kind: "status-changed",
    summary: activitySummary(status),
    payload: { status, sequence: transition.sequence },
    recordedAt: transition.occurredAt,
  });
  await dependencies.publishActivity({ workroomId: room.id, activityId: projectedActivityId });

  const candidate = notificationFor(
    status,
    room,
    `async:${transition.operation.id}:${transition.sequence}`,
  );
  if (!candidate) return { matched: true, delivered: 1, notified: 0 };
  if (!isDeliveryNotificationTransitionRecent(transition.occurredAt, dependencies.now())) {
    return { matched: true, delivered: 1, notified: 0 };
  }
  const directUserId = transition.operation.taskRun?.userId
    ?? transition.operation.workroom?.taskRun?.userId
    ?? null;
  const userId = directUserId || await dependencies.resolveOperatorUserId();
  if (!userId) return { matched: true, delivered: 1, notified: 0 };
  const notification = await dependencies.notify({ ...candidate, userId });
  return { matched: true, delivered: 1, notified: notification.created ? 1 : 0 };
}

const productionDependencies: DeliveryDependencies = {
  loadTransition: ({ operationId, sequence }) => prisma.asyncInferenceOperationTransition.findUnique({
    where: { operationId_sequence: { operationId, sequence } },
    select: {
      id: true,
      sequence: true,
      status: true,
      occurredAt: true,
      operation: {
        select: {
          id: true,
          identityVersion: true,
          taskRunId: true,
          workroomId: true,
          workroom: {
            select: {
              id: true,
              capsuleId: true,
              title: true,
              archivedAt: true,
              taskRun: { select: { userId: true } },
            },
          },
          taskRun: {
            select: {
              taskRunId: true,
              userId: true,
              workrooms: {
                where: { archivedAt: null },
                orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
                take: 2,
                select: { id: true, capsuleId: true, title: true, archivedAt: true },
              },
            },
          },
        },
      },
    },
  }) as unknown as Promise<CanonicalTransition | null>,
  recordActivity: async (activity) => {
    await prisma.workroomActivity.createMany({
      data: [{
        id: activity.id,
        workCapsuleId: activity.workroomId,
        kind: activity.kind,
        summary: activity.summary,
        payload: activity.payload,
        recordedAt: activity.recordedAt,
      }],
      skipDuplicates: true,
    });
  },
  publishActivity: ({ workroomId, activityId: persistedActivityId }) =>
    publishWorkCapsuleActivityEvent({ workCapsuleId: workroomId, activityId: persistedActivityId }),
  resolveOperatorUserId: resolveOperatorRecipient,
  notify: notifyDeliveryCandidateLive,
  now: () => new Date(),
};

export const asyncOperationTaskHub = inngest.createFunction(
  {
    id: "inference/async-operation-task-hub",
    retries: 2,
    concurrency: [{ key: "event.data.operationId", limit: 1 }],
    triggers: [{ event: ASYNC_OPERATION_TRANSITION_EVENT }],
  },
  async ({ event, step }) => step.run(
    "project-async-operation-to-task-hub",
    () => deliverAsyncOperationTransition(event.data as TransitionLocator, productionDependencies),
  ),
);
