import { createHash } from "node:crypto";

export const NONPROD_WAIT_SCHEMA_VERSION = 1 as const;

export type NonprodLeaseWaitState =
  | "waiting"
  | "capacity-available"
  | "admitted"
  | "terminal";

export type NonprodLeaseWaitProjection = {
  schemaVersion: typeof NONPROD_WAIT_SCHEMA_VERSION;
  kind: "nonprod-lease-wait";
  state: NonprodLeaseWaitState;
  leaseId: string;
  claimKey: string | null;
  environmentKey: string;
  ownerProvider: string;
  ownerSessionId: string;
  worktreePath: string | null;
  branchName: string | null;
  queuePosition: number | null;
  waitDeadlineAt: string;
  lastTransitionAt: string;
  eventId: string | null;
  eventConsumed: boolean;
};

export type NonprodCapacityEvent = {
  eventId: string;
  taskRunId: string;
  leaseId: string;
  claimKey: string | null;
  environmentKey: string;
  ownerSessionId: string;
  candidateKey: string | null;
  occurredAt: string;
};

type TaskRunRow = {
  taskRunId: string;
  status: string;
  progressPayload: unknown;
};

type DurableWaitDb = {
  taskRun?: {
    upsert(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<TaskRunRow | null>;
    findMany(args: unknown): Promise<TaskRunRow[]>;
    update(args: unknown): Promise<unknown>;
  };
  nonProductionEnvironmentLease: {
    updateMany(args: unknown): Promise<unknown>;
    findFirst?(args: unknown): Promise<WaitLease | null>;
    findMany?(args: unknown): Promise<WaitLease[]>;
  };
};

type WaitLease = {
  id: string;
  leaseId: string;
  claimKey: string | null;
  environmentKey: string;
  ownerProvider: string;
  ownerSessionId: string;
  worktreePath: string | null;
  branchName: string | null;
  taskRunId: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function parseNonprodLeaseWait(value: unknown): NonprodLeaseWaitProjection | null {
  const root = record(value);
  const candidate = record(root?.["nonprodLeaseWait"] ?? value);
  if (
    !candidate
    || candidate["schemaVersion"] !== NONPROD_WAIT_SCHEMA_VERSION
    || candidate["kind"] !== "nonprod-lease-wait"
    || !["waiting", "capacity-available", "admitted", "terminal"].includes(String(candidate["state"]))
    || !text(candidate["leaseId"])
    || !text(candidate["environmentKey"])
    || !text(candidate["ownerProvider"])
    || !text(candidate["ownerSessionId"])
    || !text(candidate["waitDeadlineAt"])
    || !text(candidate["lastTransitionAt"])
    || typeof candidate["eventConsumed"] !== "boolean"
  ) return null;
  return candidate as NonprodLeaseWaitProjection;
}

export function deterministicNonprodWaitTaskRunId(userId: string, leaseId: string): string {
  const digest = createHash("sha256").update(`${userId}\0${leaseId}`).digest("hex").slice(0, 24).toUpperCase();
  return `TR-NONPROD-${digest}`;
}

export function capacityEventId(
  environmentKey: string,
  releasedOrExpiredLeaseId: string,
  headLeaseId: string,
): string {
  return `nonprod-capacity:${environmentKey}:${releasedOrExpiredLeaseId}:${headLeaseId}`;
}

function waitPayload(existing: unknown, wait: NonprodLeaseWaitProjection) {
  return {
    ...(record(existing) ?? {}),
    summary: wait.state === "waiting"
      ? `Waiting durably for ${wait.environmentKey} capacity at queue position ${wait.queuePosition ?? "unknown"}.`
      : wait.state === "capacity-available"
        ? `Capacity may be available for ${wait.environmentKey}; re-read this task and make one fresh claim.`
        : wait.state === "admitted"
          ? `Lease ${wait.leaseId} was admitted after durable waiting.`
          : `Lease ${wait.leaseId} reached a terminal state.`,
    nonprodLeaseWait: wait,
  };
}

export async function checkpointNonprodLeaseWait(input: {
  db: DurableWaitDb & { taskRun: NonNullable<DurableWaitDb["taskRun"]> };
  userId: string;
  lease: WaitLease;
  queuePosition: number;
  waitDeadlineAt: Date;
  now?: Date;
}): Promise<{ taskRunId: string; wait: NonprodLeaseWaitProjection }> {
  const now = input.now ?? new Date();
  const taskRunId = deterministicNonprodWaitTaskRunId(input.userId, input.lease.leaseId);
  const wait: NonprodLeaseWaitProjection = {
    schemaVersion: NONPROD_WAIT_SCHEMA_VERSION,
    kind: "nonprod-lease-wait",
    state: "waiting",
    leaseId: input.lease.leaseId,
    claimKey: input.lease.claimKey,
    environmentKey: input.lease.environmentKey,
    ownerProvider: input.lease.ownerProvider,
    ownerSessionId: input.lease.ownerSessionId,
    worktreePath: input.lease.worktreePath,
    branchName: input.lease.branchName,
    queuePosition: input.queuePosition,
    waitDeadlineAt: input.waitDeadlineAt.toISOString(),
    lastTransitionAt: now.toISOString(),
    eventId: null,
    eventConsumed: false,
  };
  await input.db.taskRun.upsert({
    where: { taskRunId },
    create: {
      taskRunId,
      userId: input.userId,
      title: `Wait for ${input.lease.environmentKey} capacity`,
      objective: `Resume lease ${input.lease.leaseId} without polling or losing FIFO position.`,
      source: "proactive",
      status: "submitted",
      initiatingAgentId: input.lease.ownerProvider,
      repeatedPatternKey: `nonprod-wait:${input.lease.leaseId}`,
      a2aMetadata: {
        kind: "nonprod-lease-wait",
        leaseId: input.lease.leaseId,
        claimKey: input.lease.claimKey,
      },
      progressPayload: waitPayload(null, wait),
      lastHeartbeatAt: null,
    },
    update: {
      status: "submitted",
      completedAt: null,
      lastHeartbeatAt: null,
      repeatedPatternKey: `nonprod-wait:${input.lease.leaseId}`,
      progressPayload: waitPayload(null, wait),
    },
  });
  await input.db.nonProductionEnvironmentLease.updateMany({
    where: { id: input.lease.id, status: "queued" },
    data: { taskRunId },
  });
  return { taskRunId, wait };
}

function eventMatches(wait: NonprodLeaseWaitProjection, event: NonprodCapacityEvent): boolean {
  return wait.leaseId === event.leaseId
    && wait.claimKey === event.claimKey
    && wait.environmentKey === event.environmentKey
    && wait.ownerSessionId === event.ownerSessionId
    && wait.claimKey === event.candidateKey;
}

export async function applyNonprodCapacityEvent(input: {
  db: DurableWaitDb & { taskRun: NonNullable<DurableWaitDb["taskRun"]> };
  event: NonprodCapacityEvent;
}): Promise<{ applied: boolean; reason?: "missing" | "not-waiting" | "duplicate" | "binding-mismatch" }> {
  const task = await input.db.taskRun.findUnique({ where: { taskRunId: input.event.taskRunId } });
  if (!task) return { applied: false, reason: "missing" };
  const wait = parseNonprodLeaseWait(task.progressPayload);
  if (!wait || !["waiting", "capacity-available"].includes(wait.state)) {
    return { applied: false, reason: "not-waiting" };
  }
  if (!eventMatches(wait, input.event)) return { applied: false, reason: "binding-mismatch" };
  if (wait.eventId === input.event.eventId) return { applied: false, reason: "duplicate" };
  const next: NonprodLeaseWaitProjection = {
    ...wait,
    state: "capacity-available",
    lastTransitionAt: input.event.occurredAt,
    eventId: input.event.eventId,
    eventConsumed: false,
  };
  await input.db.taskRun.update({
    where: { taskRunId: input.event.taskRunId },
    data: { status: "submitted", progressPayload: waitPayload(task.progressPayload, next) },
  });
  return { applied: true };
}

export async function publishNonprodCapacityForHead(input: {
  db: DurableWaitDb;
  environmentKey: string;
  causeLeaseId: string;
  now?: Date;
  emit?: (event: NonprodCapacityEvent) => Promise<unknown>;
}): Promise<{ notified: number; headLeaseId: string | null }> {
  const headQuery = {
    where: { environmentKey: input.environmentKey, status: "queued" },
    orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
  };
  const head = input.db.nonProductionEnvironmentLease.findFirst
    ? await input.db.nonProductionEnvironmentLease.findFirst(headQuery)
    : (await input.db.nonProductionEnvironmentLease.findMany?.({ ...headQuery, take: 1 }))?.[0] ?? null;
  if (!head) return { notified: 0, headLeaseId: null };
  if (!input.db.taskRun) return { notified: 0, headLeaseId: head.leaseId };

  const tasks = await input.db.taskRun.findMany({
    where: {
      OR: [
        { repeatedPatternKey: `nonprod-wait:${head.leaseId}` },
        ...(head.taskRunId ? [{ taskRunId: head.taskRunId }] : []),
      ],
      status: "submitted",
    },
    orderBy: { createdAt: "asc" },
  });
  const occurredAt = (input.now ?? new Date()).toISOString();
  const emit = input.emit ?? (async (event: NonprodCapacityEvent) => {
    const { inngest } = await import("@/lib/queue/inngest-client");
    return inngest.send({ name: "nonprod/capacity.available", data: event });
  });
  let notified = 0;
  for (const task of tasks) {
    const event: NonprodCapacityEvent = {
      eventId: capacityEventId(input.environmentKey, input.causeLeaseId, head.leaseId),
      taskRunId: task.taskRunId,
      leaseId: head.leaseId,
      claimKey: head.claimKey,
      environmentKey: head.environmentKey,
      ownerSessionId: head.ownerSessionId,
      candidateKey: head.claimKey,
      occurredAt,
    };
    const applied = await applyNonprodCapacityEvent({
      db: input.db as DurableWaitDb & { taskRun: NonNullable<DurableWaitDb["taskRun"]> },
      event,
    });
    if (!applied.applied && applied.reason !== "duplicate") continue;
    await emit(event);
    notified += applied.applied ? 1 : 0;
  }
  return { notified, headLeaseId: head.leaseId };
}

export async function settleNonprodLeaseWait(input: {
  db: DurableWaitDb & { taskRun: NonNullable<DurableWaitDb["taskRun"]> };
  taskRunId: string;
  leaseId: string;
  state: "admitted" | "terminal";
  now?: Date;
}): Promise<{ settled: boolean }> {
  const task = await input.db.taskRun.findUnique({ where: { taskRunId: input.taskRunId } });
  const wait = parseNonprodLeaseWait(task?.progressPayload);
  if (!task || !wait || wait.leaseId !== input.leaseId) return { settled: false };
  const now = input.now ?? new Date();
  const next: NonprodLeaseWaitProjection = {
    ...wait,
    state: input.state,
    queuePosition: null,
    lastTransitionAt: now.toISOString(),
    eventConsumed: true,
  };
  await input.db.taskRun.update({
    where: { taskRunId: input.taskRunId },
    data: {
      status: "completed",
      completedAt: now,
      progressPayload: waitPayload(task.progressPayload, next),
    },
  });
  return { settled: true };
}
