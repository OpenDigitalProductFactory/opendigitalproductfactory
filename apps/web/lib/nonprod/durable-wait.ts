import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

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
    updateMany?(args: unknown): Promise<{ count: number }>;
  };
  nonProductionEnvironmentLease: {
    updateMany(args: unknown): Promise<unknown>;
    findFirst?(args: unknown): Promise<WaitLease | null>;
    findMany?(args: unknown): Promise<WaitLease[]>;
  };
};

type WaitLease = {
  status?: string;
  id: string;
  leaseId: string;
  claimKey: string | null;
  environmentKey: string;
  ownerProvider: string;
  ownerSessionId: string;
  worktreePath: string | null;
  branchName: string | null;
  taskRunId: string | null;
  /** BI-D35B85BF: needed to tell a waiter with a process behind it from an
   *  abandoned row. Optional so legacy callers and test doubles still typecheck. */
  queuedAt?: Date | null;
  heartbeatAt?: Date | null;
};

/**
 * How stale a waiter's last beat may be and still be worth waking.
 *
 * BI-D35B85BF. Under the detached resumer a live waiter re-claims about every
 * 20s, so a beat older than this belongs to a row with nothing behind it.
 * Waking such a row is not merely useless: because the waker notified ONLY the
 * single oldest queued row, one abandoned head absorbed every tick. On
 * 2026-09-10 the 5-minute reconciler aimed 04:23, 04:28 and 04:38 at
 * NPEL-3B6293E4CB (which then expired unadmitted at 04:40:58) and 04:43 and
 * 04:48 at NPEL-FCD900EF28 (last beat 03:22:08), while six other waiters got
 * nothing at all.
 *
 * `waiterProvesLiveness` in environment-lease-admission.ts already applies this
 * judgement when ADMITTING. The two halves used to disagree about who is alive;
 * they no longer do.
 */
export const WAITER_LIVENESS_WINDOW_MS = 5 * 60_000;

/** How far down the queue to look for a live waiter before giving up and
 *  falling back to the literal head. Bounded so a long queue of abandoned rows
 *  cannot turn one reconcile tick into an unbounded scan. */
const HEAD_SCAN_LIMIT = 10;

function waiterHasProcessBehindIt(lease: WaitLease, now: number): boolean {
  const lastBeat = lease.heartbeatAt ?? lease.queuedAt ?? null;
  if (!lastBeat) return true; // no signal either way: do not silently skip it
  return now - lastBeat.getTime() <= WAITER_LIVENESS_WINDOW_MS;
}

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
          ? `Lease ${wait.leaseId} was admitted.`
          : `Lease ${wait.leaseId} reached a terminal state.`,
    nonprodLeaseWait: wait,
  };
}

function leaseWaitProjection(input: {
  lease: WaitLease; waitDeadlineAt: Date; now: Date;
  state: "waiting" | "admitted"; queuePosition: number | null;
}): NonprodLeaseWaitProjection {
  return {
    schemaVersion: NONPROD_WAIT_SCHEMA_VERSION, kind: "nonprod-lease-wait",
    state: input.state, leaseId: input.lease.leaseId, claimKey: input.lease.claimKey,
    environmentKey: input.lease.environmentKey, ownerProvider: input.lease.ownerProvider,
    ownerSessionId: input.lease.ownerSessionId, worktreePath: input.lease.worktreePath,
    branchName: input.lease.branchName, queuePosition: input.queuePosition,
    waitDeadlineAt: input.waitDeadlineAt.toISOString(), lastTransitionAt: input.now.toISOString(),
    eventId: null, eventConsumed: input.state === "admitted",
  };
}

/** Only the fresh admission transaction may establish immediate or queued owner provenance.
 * Never backfill an old active lease or overwrite a caller's existing Task. */
export async function checkpointFreshNonprodLeaseAdmission(input: {
  db: Pick<DurableWaitDb, "nonProductionEnvironmentLease"> & {
    taskRun: Pick<NonNullable<DurableWaitDb["taskRun"]>, "upsert">;
  };
  userId: string; lease: WaitLease; waitDeadlineAt: Date; now: Date;
  previewOwner?: { schemaVersion: 1; userId: string; agentId: string; binding: Record<string, unknown> };
  queuePosition?: number;
}): Promise<string> {
  if (!input.userId.trim() || input.lease.taskRunId) throw new Error("nonprod_immediate_admission_identity_invalid");
  const taskRunId = deterministicNonprodWaitTaskRunId(input.userId, input.lease.leaseId);
  const queued = input.lease.status === "queued" && !!input.previewOwner;
  const wait = leaseWaitProjection({ ...input, state: queued ? "waiting" : "admitted",
    queuePosition: queued ? input.queuePosition ?? null : null });
  const task = record(await input.db.taskRun.upsert({
    where: { taskRunId },
    create: {
      taskRunId, userId: input.userId, title: `Admission to ${input.lease.environmentKey}`,
      objective: `Retain authenticated ownership of lease ${input.lease.leaseId}.`,
      source: "proactive", status: queued ? "submitted" : "completed", completedAt: queued ? null : input.now,
      initiatingAgentId: input.previewOwner?.agentId ?? input.lease.ownerProvider,
      repeatedPatternKey: `nonprod-wait:${input.lease.leaseId}`,
      a2aMetadata: { kind: "nonprod-lease-wait", leaseId: input.lease.leaseId, claimKey: input.lease.claimKey },
      progressPayload: { ...waitPayload(null, wait),
        ...(input.previewOwner ? { nonprodPreviewOwner: input.previewOwner } : {}) }, lastHeartbeatAt: null,
    },
    update: {},
  }));
  const storedWait = parseNonprodLeaseWait(task?.["progressPayload"]);
  if (!task || task["taskRunId"] !== taskRunId || task["userId"] !== input.userId
    || !storedWait || Object.entries(wait).some(([key, value]) => storedWait[key as keyof NonprodLeaseWaitProjection] !== value)
    || (input.previewOwner && (task["initiatingAgentId"] !== input.previewOwner.agentId
      || !isDeepStrictEqual(record(task["progressPayload"])?.["nonprodPreviewOwner"], input.previewOwner)))) {
    throw new Error("nonprod_immediate_admission_provenance_conflict");
  }
  const linked = record(await input.db.nonProductionEnvironmentLease.updateMany({
    where: { id: input.lease.id, status: queued ? "queued" : "active", taskRunId: null }, data: { taskRunId },
  }));
  if (linked?.["count"] !== 1) throw new Error("nonprod_immediate_admission_link_conflict");
  return taskRunId;
}

export const checkpointImmediateNonprodLeaseAdmission = checkpointFreshNonprodLeaseAdmission;

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
  const wait = leaseWaitProjection({ ...input, now, state: "waiting" });
  if (input.lease.environmentKey === "active-candidate" && input.lease.taskRunId
    && input.lease.taskRunId !== taskRunId) {
    const linked = await input.db.taskRun.findUnique({ where: { taskRunId: input.lease.taskRunId } });
    if (record(linked?.progressPayload)?.["nonprodPreviewOwner"] !== undefined) {
      throw new Error("nonprod_preview_ownership_conflict");
    }
  }
  const existing = await input.db.taskRun.findUnique({ where: { taskRunId } });
  const progressPayload = waitPayload(existing?.progressPayload, wait);
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
      progressPayload,
      lastHeartbeatAt: null,
    },
    update: {
      status: "submitted",
      completedAt: null,
      lastHeartbeatAt: null,
      repeatedPatternKey: `nonprod-wait:${input.lease.leaseId}`,
      progressPayload,
    },
  });
  await input.db.nonProductionEnvironmentLease.updateMany({
    where: { id: input.lease.id, status: "queued" },
    data: { taskRunId, expiresAt: input.waitDeadlineAt },
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
  if (task.status !== "submitted" || !wait || !["waiting", "capacity-available"].includes(wait.state)) {
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
  // Capacity delivery races expiry and admission outside the environment
  // transaction. Never revive a wait from the snapshot read above.
  if (!input.db.taskRun.updateMany) return { applied: false, reason: "not-waiting" };
  const result = await input.db.taskRun.updateMany({
    where: { taskRunId: input.event.taskRunId, status: "submitted",
      progressPayload: { equals: task.progressPayload } },
    data: { status: "submitted", progressPayload: waitPayload(task.progressPayload, next) },
  });
  return result.count === 1 ? { applied: true } : { applied: false, reason: "not-waiting" };
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
  // BI-D35B85BF. Take the first waiter that still has a process behind it, in
  // FIFO order. An abandoned row keeps its queue position - it is not expired
  // here - but it no longer swallows the wake that the waiters behind it need.
  // Falling back to the literal head when nothing proves live keeps the old
  // behaviour rather than notifying nobody.
  const candidates: WaitLease[] = input.db.nonProductionEnvironmentLease.findMany
    ? await input.db.nonProductionEnvironmentLease.findMany({ ...headQuery, take: HEAD_SCAN_LIMIT }) ?? []
    : [await input.db.nonProductionEnvironmentLease.findFirst?.(headQuery)].filter(
      (row): row is WaitLease => Boolean(row),
    );
  const now = (input.now ?? new Date()).getTime();
  const head = candidates.find((lease) => waiterHasProcessBehindIt(lease, now))
    ?? candidates[0]
    ?? null;
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
    const { jobs } = await import("@/lib/jobs");
    return jobs.send({ name: "nonprod/capacity.available", data: event });
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

type SettleNonprodLeaseWaitInput = {
  db: DurableWaitDb & { taskRun: NonNullable<DurableWaitDb["taskRun"]> };
  taskRunId: string;
  leaseId: string;
  state: "admitted" | "terminal";
  /** Automatic expiry validates all persisted ownership fields and uses CAS. */
  expiredLease?: WaitLease;
  now?: Date;
};

export async function settleNonprodLeaseWait(input: SettleNonprodLeaseWaitInput): Promise<{ settled: boolean }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await settleNonprodLeaseWaitOnce(input);
    if (!result.retryable) return { settled: result.settled };
  }
  // Automatic expiry runs inside the lease transaction. Persistent contention
  // must roll it back, leaving the active/queued row visible for a later pass.
  throw new Error("nonprod_expiry_wait_settlement_contended");
}

async function settleNonprodLeaseWaitOnce(input: SettleNonprodLeaseWaitInput): Promise<{ settled: boolean; retryable?: boolean }> {
  const task = await input.db.taskRun.findUnique({ where: { taskRunId: input.taskRunId } });
  const wait = parseNonprodLeaseWait(task?.progressPayload);
  if (!task || !wait || wait.leaseId !== input.leaseId) return { settled: false };
  if (input.expiredLease) {
    const lease = input.expiredLease;
    if (task.taskRunId !== lease.taskRunId
      || wait.claimKey !== lease.claimKey
      || wait.environmentKey !== lease.environmentKey
      || wait.ownerProvider !== lease.ownerProvider
      || wait.ownerSessionId !== lease.ownerSessionId
      || wait.worktreePath !== lease.worktreePath
      || wait.branchName !== lease.branchName) return { settled: false };
  }
  // A release retry closes no new wait and must not rewrite admission history
  // or its clock. Completion here concerns the wait, never command execution.
  if (task.status === "completed" && wait.eventConsumed
    && (wait.state === "admitted" || wait.state === "terminal")) return { settled: true };
  const now = input.now ?? new Date();
  const next: NonprodLeaseWaitProjection = {
    ...wait,
    state: input.state,
    queuePosition: null,
    lastTransitionAt: now.toISOString(),
    eventConsumed: true,
  };
  const data = {
      status: "completed",
      completedAt: now,
      progressPayload: waitPayload(task.progressPayload, next),
  };
  if (input.expiredLease) {
    if (task.status !== "submitted" || !input.db.taskRun.updateMany) return { settled: false };
    const result = await input.db.taskRun.updateMany({
      where: { taskRunId: input.taskRunId, status: task.status,
        progressPayload: { equals: task.progressPayload } },
      data,
    });
    return { settled: result.count === 1, retryable: result.count === 0 };
  }
  await input.db.taskRun.update({ where: { taskRunId: input.taskRunId }, data });
  return { settled: true };
}

/** Called only inside the transaction that expires these exact lease rows. */
export async function settleExpiredNonprodLeaseWaits(input: {
  db: DurableWaitDb;
  leaseIds: string[];
  now: Date;
}): Promise<void> {
  if (!input.db.taskRun || !input.db.nonProductionEnvironmentLease.findMany) return;
  const expired = await input.db.nonProductionEnvironmentLease.findMany({
    where: { id: { in: input.leaseIds }, status: "expired", releasedAt: input.now },
  });
  for (const lease of expired) {
    if (!lease.taskRunId) continue;
    await settleNonprodLeaseWait({ db: input.db as DurableWaitDb & { taskRun: NonNullable<DurableWaitDb["taskRun"]> },
      taskRunId: lease.taskRunId, leaseId: lease.leaseId, state: "terminal",
      expiredLease: lease, now: input.now });
  }
}

export async function afterNonprodLeaseRelease(input: {
  db: DurableWaitDb;
  lease: WaitLease & { status: string };
  priorStatus: string;
  now: Date;
}) {
  if (input.lease.taskRunId && input.db.taskRun) {
    await settleNonprodLeaseWait({
      db: input.db as DurableWaitDb & { taskRun: NonNullable<DurableWaitDb["taskRun"]> },
      taskRunId: input.lease.taskRunId,
      leaseId: input.lease.leaseId,
      // Expiry/cancellation (including a repeated release) proves no admission.
      // A released lease previously passed through active in this lifecycle.
      state: input.priorStatus === "active" || input.priorStatus === "released" ? "admitted" : "terminal",
      now: input.now,
    });
  }
  return publishNonprodCapacityForHead({
    db: input.db,
    environmentKey: input.lease.environmentKey,
    causeLeaseId: input.lease.leaseId,
    now: input.now,
  });
}
