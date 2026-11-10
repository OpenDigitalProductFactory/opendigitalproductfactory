import { createHash } from "node:crypto";

export type DeliveryNotificationKind = "completed" | "failed" | "expired" | "reconciliation-required" | "approval-required" | "approval-expired" | "input-required" | "review-required" | "takeover-ready";

export type DeliveryNotificationCandidate = {
  capsuleId: string;
  title: string;
  kind: DeliveryNotificationKind;
  sourceKey: string;
  body: string;
  deepLink: string;
};

export type DeliveryNotificationSource = {
  capsuleId: string;
  title: string;
  status: string;
  updatedAt: Date;
  leaseExpiresAt: Date | null;
  taskRun: null | {
    taskRunId: string;
    userId?: string;
    status: string;
    updatedAt: Date;
    actionEnvelopes?: ReadonlyArray<{ id: string; status: string; expiresAt: Date | null }>;
  };
};

export const DELIVERY_NOTIFICATION_WINDOW_MS = 30 * 60 * 1_000;

export function isDeliveryNotificationTransitionRecent(sourceAt: Date, now: Date): boolean {
  const ageMs = now.getTime() - sourceAt.getTime();
  return ageMs >= -60_000 && ageMs <= DELIVERY_NOTIFICATION_WINDOW_MS;
}

function transition(input: DeliveryNotificationSource, now: Date): Omit<DeliveryNotificationCandidate, "capsuleId" | "title"> | null {
  const detail = `/build/work/${encodeURIComponent(input.capsuleId)}`;
  const task = input.taskRun;
  const pendingEnvelope = task?.actionEnvelopes?.find((item) =>
    item.status === "proposed" && (!item.expiresAt || item.expiresAt > now));
  if (pendingEnvelope) {
    if (!isDeliveryNotificationTransitionRecent(task!.updatedAt, now)) return null;
    return {
      kind: "approval-required",
      sourceKey: pendingEnvelope.id,
      body: "A governed action is waiting for review.",
      deepLink: `${detail}#review`,
    };
  }
  const expiredEnvelope = task?.actionEnvelopes?.find((item) =>
    ["proposed", "approved"].includes(item.status) && item.expiresAt != null && item.expiresAt <= now);
  if (expiredEnvelope) {
    if (!isDeliveryNotificationTransitionRecent(expiredEnvelope.expiresAt!, now)) return null;
    return {
      kind: "approval-expired",
      sourceKey: expiredEnvelope.id,
      body: "A governed approval expired before delivery could resume.",
      deepLink: `${detail}#review`,
    };
  }
  const taskFailed = ["failed", "rejected", "canceled", "stalled", "auth-required"].includes(task?.status ?? "");
  if (taskFailed) {
    if (!isDeliveryNotificationTransitionRecent(task!.updatedAt, now)) return null;
    return {
      kind: "failed",
      sourceKey: `${task!.taskRunId}:${task!.updatedAt.toISOString()}`,
      body: "Delivery needs attention before it can continue.",
      deepLink: `${detail}#activity`,
    };
  }
  if (input.status === "blocked") {
    if (!isDeliveryNotificationTransitionRecent(input.updatedAt, now)) return null;
    return {
      kind: "failed",
      sourceKey: `${input.capsuleId}:${input.updatedAt.toISOString()}`,
      body: "Delivery needs attention before it can continue.",
      deepLink: `${detail}#activity`,
    };
  }
  if (input.status === "working" && input.leaseExpiresAt && input.leaseExpiresAt <= now) {
    if (!isDeliveryNotificationTransitionRecent(input.leaseExpiresAt, now)) return null;
    return {
      kind: "takeover-ready",
      sourceKey: input.leaseExpiresAt.toISOString(),
      body: "The Workroom lease expired and is ready for governed takeover.",
      deepLink: `${detail}#handoff`,
    };
  }
  if (task?.status === "input-required") {
    if (!isDeliveryNotificationTransitionRecent(task.updatedAt, now)) return null;
    return {
      kind: "input-required",
      sourceKey: `${task.taskRunId}:${task.updatedAt.toISOString()}`,
      body: "Delivery is waiting for operator input.",
      deepLink: `${detail}#activity`,
    };
  }
  if (input.status === "ready-for-review" || input.status === "ready-for-promotion") {
    if (!isDeliveryNotificationTransitionRecent(input.updatedAt, now)) return null;
    return {
      kind: "review-required",
      sourceKey: input.updatedAt.toISOString(),
      body: "Delivery is ready for its governed review.",
      deepLink: `${detail}#review`,
    };
  }
  if (input.status === "complete" && (!task || task.status === "completed" || task.status === "archived")) {
    const completedAt = task?.updatedAt ?? input.updatedAt;
    if (!isDeliveryNotificationTransitionRecent(completedAt, now)) return null;
    return {
      kind: "completed",
      sourceKey: completedAt.toISOString(),
      body: "Delivery completed. Open the Workroom for the verified result.",
      deepLink: `${detail}#result`,
    };
  }
  return null;
}

export function projectDeliveryNotificationCandidate(
  input: DeliveryNotificationSource,
  now: Date = new Date(),
): DeliveryNotificationCandidate | null {
  const selected = transition(input, now);
  return selected ? { capsuleId: input.capsuleId, title: input.title, ...selected } : null;
}

export function deliveryNotificationType(input: Pick<DeliveryNotificationCandidate, "capsuleId" | "kind" | "sourceKey">): string {
  return `attention:delivery-task:${input.capsuleId}:${input.kind}:${input.sourceKey}`;
}

export function deliveryNotificationId(userId: string, type: string): string {
  return `ntf_delivery_${createHash("sha256").update(`${userId}\0${type}`, "utf8").digest("hex").slice(0, 32)}`;
}

export async function notifyDeliveryTransition(
  deps: {
    hasAny: (userId: string, type: string) => Promise<boolean>;
    create: (input: { id: string; userId: string; type: string; title: string; body: string; deepLink: string }) => Promise<boolean>;
    emit?: (input: { source: "delivery-task"; itemKey: string; userId: string; title: string; deepLink: string }) => void;
  },
  input: DeliveryNotificationCandidate & { userId: string },
): Promise<{ created: boolean }> {
  const type = deliveryNotificationType(input);
  if (await deps.hasAny(input.userId, type)) return { created: false };
  const created = await deps.create({
    id: deliveryNotificationId(input.userId, type),
    userId: input.userId,
    type,
    title: input.title,
    body: input.body,
    deepLink: input.deepLink,
  });
  if (!created) return { created: false };
  deps.emit?.({ source: "delivery-task", itemKey: type, userId: input.userId, title: input.title, deepLink: input.deepLink });
  return { created: true };
}

export async function reconcileDeliveryTaskNotifications(
  deps: {
    listRecent: (bounds: { since: Date; take: number }) => Promise<DeliveryNotificationSource[]>;
    resolveOperatorUserId: () => Promise<string | null>;
    notify: (input: DeliveryNotificationCandidate & { userId: string }) => Promise<{ created: boolean }>;
  },
  now: Date = new Date(),
): Promise<{ scanned: number; created: number; failed: number }> {
  let sources: DeliveryNotificationSource[];
  try {
    sources = await deps.listRecent({ since: new Date(now.getTime() - DELIVERY_NOTIFICATION_WINDOW_MS), take: 100 });
  } catch {
    return { scanned: 0, created: 0, failed: 1 };
  }
  let operatorUserId: string | null | undefined;
  let created = 0;
  let failed = 0;
  for (const source of sources) {
    const candidate = projectDeliveryNotificationCandidate(source, now);
    if (!candidate) continue;
    try {
      const directUserId = source.taskRun?.userId?.trim() || null;
      if (!directUserId && operatorUserId === undefined) operatorUserId = await deps.resolveOperatorUserId();
      const userId = directUserId ?? operatorUserId ?? null;
      if (!userId) continue;
      const result = await deps.notify({ ...candidate, userId });
      if (result.created) created += 1;
    } catch {
      failed += 1;
    }
  }
  return { scanned: sources.length, created, failed };
}
