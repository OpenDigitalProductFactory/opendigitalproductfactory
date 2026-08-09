import type { QueueTransitionInput } from "@/lib/queue/queue-telemetry";
import { recordQueueTransition } from "@/lib/queue/queue-telemetry";

export const FEDERATION_DELIVERY_QUEUE_ID = "federation-delivery";
export const FEDERATION_DELIVERY_QUEUE_KEY = `cwq:${FEDERATION_DELIVERY_QUEUE_ID}`;

type TelemetryWriter = (input: QueueTransitionInput) => Promise<void>;

export interface FederationDeliveryQueueDb {
  workQueue: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  workItem: {
    upsert(args: unknown): Promise<{ itemId: string }>;
    update(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
    findMany?(args: unknown): Promise<Array<{
      itemId: string;
      sourceId: string | null;
      attemptCount: number;
      createdAt: Date;
      claimedAt: Date | null;
    }>>;
  };
}

export async function claimFederationDeliveryJob(
  db: FederationDeliveryQueueDb,
  itemId: string,
  now = new Date(),
  telemetry: TelemetryWriter = recordQueueTransition,
): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - 5 * 60_000);
  const claimed = await db.workItem.updateMany({
    where: {
      itemId,
      OR: [
        { status: "queued" },
        { status: "in-progress", lastAttemptAt: { lte: staleBefore } },
      ],
    },
    data: { status: "in-progress", lastAttemptAt: now },
  });
  if (claimed.count !== 1) return false;
  await telemetry({
    queueKey: FEDERATION_DELIVERY_QUEUE_KEY,
    itemKind: "federation-demand",
    itemId,
    transition: "started",
    actorType: "system",
    occurredAt: now,
  });
  return true;
}

async function ensureQueue(db: FederationDeliveryQueueDb): Promise<{ id: string }> {
  return db.workQueue.upsert({
    where: { queueId: FEDERATION_DELIVERY_QUEUE_ID },
    create: {
      queueId: FEDERATION_DELIVERY_QUEUE_ID,
      name: "Federation delivery",
      queueType: "delivery",
      routingPolicy: { mode: "system", protocol: "activitypub-inbox" },
    },
    update: { isActive: true },
    select: { id: true },
  });
}

/** Rolling-upgrade bridge: create a job for a legacy pending mirror without
 * resetting an existing job's retry state. */
export async function ensureFederationDeliveryJob(
  db: FederationDeliveryQueueDb,
  mirrorId: string,
  now = new Date(),
): Promise<{ itemId: string }> {
  const queue = await ensureQueue(db);
  return db.workItem.upsert({
    where: { sourceKey: `federation-demand:${mirrorId}` },
    create: {
      sourceKey: `federation-demand:${mirrorId}`,
      sourceType: "federation-demand-delivery",
      sourceId: mirrorId,
      title: `Deliver federated demand ${mirrorId}`,
      description: "Deliver one minimized, versioned demand envelope to a trusted peer inbox.",
      workerConstraint: { workerType: "system" },
      queueId: queue.id,
      status: "queued",
      nextAttemptAt: now,
    },
    update: {},
    select: { itemId: true },
  });
}

export async function scheduleFederationDeliveryJob(
  db: FederationDeliveryQueueDb,
  mirrorId: string,
  now = new Date(),
  telemetry: TelemetryWriter = recordQueueTransition,
): Promise<{ itemId: string }> {
  const queue = await ensureQueue(db);
  const item = await db.workItem.upsert({
    where: { sourceKey: `federation-demand:${mirrorId}` },
    create: {
      sourceKey: `federation-demand:${mirrorId}`,
      sourceType: "federation-demand-delivery",
      sourceId: mirrorId,
      title: `Deliver federated demand ${mirrorId}`,
      description: "Deliver one minimized, versioned demand envelope to a trusted peer inbox.",
      workerConstraint: { workerType: "system" },
      queueId: queue.id,
      status: "queued",
      nextAttemptAt: now,
    },
    update: {
      status: "queued",
      attemptCount: 0,
      nextAttemptAt: now,
      lastAttemptAt: null,
      lastError: null,
      completedAt: null,
    },
    select: { itemId: true },
  });
  await telemetry({
    queueKey: FEDERATION_DELIVERY_QUEUE_KEY,
    itemKind: "federation-demand",
    itemId: item.itemId,
    transition: "enqueued",
    actorType: "system",
    occurredAt: now,
  });
  return item;
}

export async function finishFederationDeliveryJob(
  db: FederationDeliveryQueueDb,
  input: {
    itemId: string;
    attemptCount: number;
    outcome: "success" | "retry" | "dead-letter";
    error?: string | null;
    now: Date;
    nextAttemptAt?: Date | null;
  },
  telemetry: TelemetryWriter = recordQueueTransition,
): Promise<void> {
  const attempts = input.attemptCount + 1;
  const retry = input.outcome === "retry";
  await db.workItem.update({
    where: { itemId: input.itemId },
    data: {
      status: retry ? "queued" : input.outcome === "success" ? "completed" : "failed",
      attemptCount: attempts,
      nextAttemptAt: retry ? input.nextAttemptAt ?? null : null,
      lastAttemptAt: input.now,
      lastError: input.error?.slice(0, 1_000) ?? null,
      completedAt: input.outcome === "success" ? input.now : null,
    },
  });
  await telemetry({
    queueKey: FEDERATION_DELIVERY_QUEUE_KEY,
    itemKind: "federation-demand",
    itemId: input.itemId,
    transition: retry ? "requeued" : "finished",
    outcome: input.outcome === "success" ? "success" : "failed",
    actorType: "system",
    occurredAt: input.now,
  });
}
