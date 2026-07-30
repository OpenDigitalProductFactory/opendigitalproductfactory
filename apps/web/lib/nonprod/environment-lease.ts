import { randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";
import {
  planEnvironmentAdmission,
  type AdmissionLease,
} from "./environment-lease-admission";
import { recordQueueTransition } from "@/lib/queue/queue-telemetry";

export type NonprodEnvironmentKey = "active-candidate" | "local-integration-ci";
/** Host-worktree coding surfaces + BS/coworker that may claim a shared nonprod lease. */
export type NonprodOwnerProvider =
  | "build-studio"
  | "claude"
  | "codex"
  | "grok"
  | "antigravity"
  | "coworker";

export const NONPROD_OWNER_PROVIDERS: readonly NonprodOwnerProvider[] = [
  "build-studio",
  "claude",
  "codex",
  "grok",
  "antigravity",
  "coworker",
] as const;

// Phase 1 deliberately retains singleton capacity. Phase 2 makes every mutable
// resource slot-scoped before a later pilot can safely add slot-1.
export const NONPROD_SLOT_KEYS = ["slot-0"] as const;

type LeaseModel = typeof prisma.nonProductionEnvironmentLease;
type LeaseTx = Pick<typeof prisma, "$executeRaw" | "nonProductionEnvironmentLease">;
type LeaseDb = Pick<typeof prisma, "nonProductionEnvironmentLease">
  & Partial<Pick<typeof prisma, "$transaction" | "$executeRaw">>;
type LeaseRow = NonNullable<Awaited<ReturnType<LeaseModel["findUnique"]>>>;

// BI-4043A64B — anti-monopolization for the shared nonprod pool. A holder must
// heartbeat; queued claim retries also refresh this bounded liveness window.
export const MAX_LEASE_TTL_MS = 20 * 60_000;
export const DEFAULT_LEASE_TTL_MS = 15 * 60_000;
// A queued request can remain observable for the normal bounded window, but an
// admitted singleton local-CI owner must prove liveness frequently. If its host
// process disappears immediately after admission, FIFO reconciliation can
// recover the slot within this bound instead of waiting 15-20 minutes.
export const LOCAL_CI_ACTIVE_LEASE_TTL_MS = 2 * 60_000;

export function admittedLeaseTtlMs(
  environmentKey: string,
  requestedMs: number,
): number {
  if (!Number.isFinite(requestedMs) || requestedMs <= 0) {
    throw new Error("nonprod_lease_ttl_must_be_positive");
  }
  const boundedRequest = Math.min(
    MAX_LEASE_TTL_MS,
    requestedMs,
  );
  return environmentKey === "local-integration-ci"
    ? Math.min(LOCAL_CI_ACTIVE_LEASE_TTL_MS, boundedRequest)
    : boundedRequest;
}

export function clampLeaseExpiry(
  now: Date,
  requested: Date | undefined,
  ttlMs: number = DEFAULT_LEASE_TTL_MS,
): Date {
  const cap = now.getTime() + MAX_LEASE_TTL_MS;
  const want = (requested ?? new Date(now.getTime() + ttlMs)).getTime();
  return new Date(Math.min(want, cap));
}

function requestedTtlMs(now: Date, requested: Date): number {
  return Math.max(
    1,
    Math.min(MAX_LEASE_TTL_MS, requested.getTime() - now.getTime()),
  );
}

function createLeaseId() {
  return `NPEL-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

function isTerminalLeaseStatus(
  status: string,
): status is "released" | "expired" | "cancelled" {
  return status === "released" || status === "expired" || status === "cancelled";
}

async function inLeaseTransaction<T>(
  db: LeaseDb,
  body: (tx: LeaseTx) => Promise<T>,
): Promise<T> {
  if (typeof db.$transaction !== "function") {
    return body(db as LeaseTx);
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => body(tx as LeaseTx),
        // The transaction-level advisory lock is the serialization primitive.
        // READ COMMITTED gives a waiter a fresh snapshot after acquiring that
        // lock; SERIALIZABLE would retain the pre-wait snapshot and provoke a
        // retry storm under a long FIFO queue.
        { isolationLevel: "ReadCommitted" },
      );
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";
      // A concurrent idempotent insert or serializable write conflict means
      // another claimant committed first. A fresh transaction can now observe
      // and return that same durable claim row.
      if (!["P2002", "P2034"].includes(code) || attempt >= 2) throw error;
    }
  }
}

function queueKey(environmentKey: string): string {
  return `compute:nonprod-${environmentKey}`;
}

type LeaseTransitionInput = {
  lease: LeaseRow;
  transition: "enqueued" | "started" | "finished" | "cancelled";
  outcome?: "success" | "failed" | "cancelled";
  depth?: number;
  waitMs?: number;
  processMs?: number;
  cycleMs?: number;
};

function emitLeaseTransition(input: LeaseTransitionInput) {
  return recordQueueTransition({
    queueKey: queueKey(input.lease.environmentKey),
    itemKind: "nonprod-environment-lease",
    itemId: input.lease.leaseId,
    transition: input.transition,
    outcome: input.outcome,
    laneKey: input.lease.slotKey,
    actorType: "system",
    depth: input.depth,
    durations: {
      waitMs: input.waitMs,
      processMs: input.processMs,
      cycleMs: input.cycleMs,
    },
  });
}

async function emitLeaseTransitions(inputs: LeaseTransitionInput[]) {
  for (const input of inputs) {
    await emitLeaseTransition(input);
  }
}

async function lockEnvironment(
  tx: LeaseTx,
  environmentKey: string,
): Promise<void> {
  if (typeof tx.$executeRaw !== "function") return;
  const lockKey = `dpf:nonprod-environment:${environmentKey}`;
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
  `;
}

async function reconcileEnvironmentInTransaction(input: {
  tx: LeaseTx;
  environmentKey: string;
  now: Date;
}): Promise<{
  expiredLeaseIds: string[];
  admittedLeaseIds: string[];
  queueDepth: number;
}> {
  const rows = await input.tx.nonProductionEnvironmentLease.findMany({
    where: {
      environmentKey: input.environmentKey,
      status: { in: ["active", "queued"] },
    },
    orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
  });
  const plan = planEnvironmentAdmission({
    leases: rows as AdmissionLease[],
    now: input.now,
    slotKeys: [...NONPROD_SLOT_KEYS],
  });

  if (plan.expiredLeaseIds.length > 0) {
    await input.tx.nonProductionEnvironmentLease.updateMany({
      where: { id: { in: plan.expiredLeaseIds } },
      data: {
        status: "expired",
        activeKey: null,
        phase: "expired",
        releasedAt: input.now,
      },
    });
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const admission of plan.admissions) {
    const row = byId.get(admission.leaseId);
    const ttlMs = admittedLeaseTtlMs(
      input.environmentKey,
      Number(row?.requestedTtlMs ?? DEFAULT_LEASE_TTL_MS),
    );
    await input.tx.nonProductionEnvironmentLease.update({
      where: { id: admission.leaseId },
      data: {
        status: "active",
        slotKey: admission.slotKey,
        activeKey: `${input.environmentKey}:${admission.slotKey}`,
        admittedAt: input.now,
        heartbeatAt: input.now,
        phase: "admitted",
        expiresAt: new Date(input.now.getTime() + ttlMs),
      },
    });
  }

  return {
    expiredLeaseIds: plan.expiredLeaseIds,
    admittedLeaseIds: plan.admissions.map((entry) => entry.leaseId),
    queueDepth: plan.queuePositions.length,
  };
}

export async function listActiveNonprodEnvironmentLeases(input: {
  db?: LeaseDb;
  now?: Date;
}) {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  return db.nonProductionEnvironmentLease.findMany({
    where: {
      status: "active",
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function listQueuedNonprodEnvironmentLeases(input: {
  db?: LeaseDb;
  now?: Date;
}) {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  return db.nonProductionEnvironmentLease.findMany({
    where: {
      status: "queued",
      expiresAt: { gt: now },
    },
    orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
  });
}

export type ClaimNonprodEnvironmentLeaseResult =
  | {
    status: "admitted";
    lease: LeaseRow;
    slotKey: string;
    waitAgeMs: number;
  }
  | {
    status: "queued";
    lease: LeaseRow;
    queuePosition: number;
    waitAgeMs: number;
  }
  | {
    status: "terminal";
    lease: LeaseRow;
    reason: "released" | "expired" | "cancelled";
  };

export async function claimNonprodEnvironmentLease(input: {
  db?: LeaseDb;
  environmentKey: NonprodEnvironmentKey;
  ownerProvider: NonprodOwnerProvider;
  ownerSessionId: string;
  claimKey?: string;
  purpose: string;
  url: string;
  ports: number[];
  expiresAt: Date;
  worktreePath?: string;
  branchName?: string;
  buildId?: string;
  taskRunId?: string;
  cleanupCommand?: string;
  now?: Date;
}): Promise<ClaimNonprodEnvironmentLeaseResult> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const ttlMs = requestedTtlMs(now, input.expiresAt);
  let created = false;
  let admittedNow = false;
  let queueDepth = 0;

  const result = await inLeaseTransaction<ClaimNonprodEnvironmentLeaseResult>(
    db,
    async (tx) => {
    created = false;
    admittedNow = false;
    queueDepth = 0;
    await lockEnvironment(tx, input.environmentKey);

    let lease = input.claimKey
      ? await tx.nonProductionEnvironmentLease.findUnique({
        where: { claimKey: input.claimKey },
      })
      : null;

    if (lease && isTerminalLeaseStatus(lease.status)) {
      return {
        status: "terminal",
        lease,
        reason: lease.status,
      };
    }

    if (lease) {
      if (lease.environmentKey !== input.environmentKey) {
        throw new Error("nonprod_claim_key_environment_mismatch");
      }
      if (lease.ownerSessionId !== input.ownerSessionId) {
        throw new Error("nonprod_claim_key_owner_mismatch");
      }
      if (lease.status === "queued") {
        lease = await tx.nonProductionEnvironmentLease.update({
          where: { id: lease.id },
          data: {
            requestedTtlMs: ttlMs,
            heartbeatAt: now,
            expiresAt: new Date(now.getTime() + ttlMs),
            phase: "waiting",
          },
        });
      }
    } else {
      lease = await tx.nonProductionEnvironmentLease.create({
        data: {
          leaseId: createLeaseId(),
          claimKey: input.claimKey,
          environmentKey: input.environmentKey,
          activeKey: null,
          slotKey: null,
          status: "queued",
          ownerProvider: input.ownerProvider,
          ownerSessionId: input.ownerSessionId,
          purpose: input.purpose,
          url: input.url,
          ports: input.ports,
          requestedTtlMs: ttlMs,
          expiresAt: new Date(now.getTime() + ttlMs),
          queuedAt: now,
          heartbeatAt: now,
          phase: "waiting",
          worktreePath: input.worktreePath,
          branchName: input.branchName,
          buildId: input.buildId,
          taskRunId: input.taskRunId,
          cleanupCommand: input.cleanupCommand,
        },
      });
      created = true;
    }

    const reconciliation = await reconcileEnvironmentInTransaction({
      tx,
      environmentKey: input.environmentKey,
      now,
    });
    admittedNow = reconciliation.admittedLeaseIds.includes(lease.id);
    queueDepth = reconciliation.queueDepth;
    const current = await tx.nonProductionEnvironmentLease.findUnique({
      where: { id: lease.id },
    });
    if (!current) throw new Error("nonprod_claim_disappeared");
    const waitAgeMs = Math.max(
      0,
      now.getTime() - (current.queuedAt ?? current.createdAt).getTime(),
    );
    if (current.status === "active" && current.slotKey) {
      return {
        status: "admitted",
        lease: current,
        slotKey: current.slotKey,
        waitAgeMs,
      };
    }
    if (current.status !== "queued") {
      if (!isTerminalLeaseStatus(current.status)) {
        throw new Error(`nonprod_claim_invalid_status:${current.status}`);
      }
      return {
        status: "terminal",
        lease: current,
        reason: current.status,
      };
    }
    const queue = await tx.nonProductionEnvironmentLease.findMany({
      where: {
        environmentKey: input.environmentKey,
        status: "queued",
      },
      orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    return {
      status: "queued",
      lease: current,
      queuePosition: queue.findIndex((row) => row.id === current.id) + 1,
      waitAgeMs,
    };
    },
  );
  const transitions: LeaseTransitionInput[] = [];
  if (created) {
    transitions.push({
      lease: result.lease,
      transition: "enqueued",
      depth: queueDepth + (result.status === "admitted" ? 1 : 0),
    });
  }
  if (result.status === "admitted" && admittedNow) {
    transitions.push({
      lease: result.lease,
      transition: "started",
      depth: queueDepth,
      waitMs: result.waitAgeMs,
    });
  }
  void emitLeaseTransitions(transitions);
  return result;
}

export async function releaseNonprodEnvironmentLease(input: {
  db?: LeaseDb;
  leaseId: string;
  now?: Date;
}) {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  let priorStatus = "";
  const result = await inLeaseTransaction(db, async (tx) => {
    const beforeLock = await tx.nonProductionEnvironmentLease.findUnique({
      where: { leaseId: input.leaseId },
    });
    if (!beforeLock) throw new Error("nonprod_lease_not_found");
    await lockEnvironment(tx, beforeLock.environmentKey);
    const current = await tx.nonProductionEnvironmentLease.findUnique({
      where: { leaseId: input.leaseId },
    });
    if (!current) throw new Error("nonprod_lease_not_found");
    if (isTerminalLeaseStatus(current.status)) {
      return {
        lease: current,
        promotedLeaseIds: [] as string[],
        queueDepth: 0,
      };
    }
    priorStatus = current.status;
    const queued = current.status === "queued";
    const lease = await tx.nonProductionEnvironmentLease.update({
      where: { leaseId: input.leaseId },
      data: {
        status: queued ? "cancelled" : "released",
        releasedAt: now,
        cancelledAt: queued ? now : current.cancelledAt,
        activeKey: null,
        phase: queued ? "cancelled" : "released",
      },
    });
    const reconciliation = await reconcileEnvironmentInTransaction({
      tx,
      environmentKey: current.environmentKey,
      now,
    });
    return {
      lease,
      promotedLeaseIds: reconciliation.admittedLeaseIds,
      queueDepth: reconciliation.queueDepth,
    };
  });
  const transitions: LeaseTransitionInput[] = [];
  if (priorStatus === "queued") {
    transitions.push({
      lease: result.lease,
      transition: "cancelled",
      outcome: "cancelled",
      depth: result.queueDepth,
      cycleMs: result.lease.queuedAt
        ? Math.max(0, now.getTime() - result.lease.queuedAt.getTime())
        : undefined,
    });
  } else if (priorStatus === "active") {
    transitions.push({
      lease: result.lease,
      transition: "finished",
      outcome: "success",
      depth: result.queueDepth,
      processMs: result.lease.admittedAt
        ? Math.max(0, now.getTime() - result.lease.admittedAt.getTime())
        : undefined,
      cycleMs: result.lease.queuedAt
        ? Math.max(0, now.getTime() - result.lease.queuedAt.getTime())
        : undefined,
    });
  }
  if (result.promotedLeaseIds.length > 0) {
    const promoted = await db.nonProductionEnvironmentLease.findMany({
      where: { id: { in: result.promotedLeaseIds } },
    });
    for (const lease of promoted) {
      transitions.push({
        lease,
        transition: "started",
        waitMs: lease.queuedAt
          ? Math.max(0, now.getTime() - lease.queuedAt.getTime())
          : undefined,
      });
    }
  }
  void emitLeaseTransitions(transitions);
  return result.lease;
}

export async function renewNonprodEnvironmentLease(input: {
  db?: LeaseDb;
  leaseId: string;
  ownerSessionId: string;
  ttlMs?: number;
  now?: Date;
}): Promise<
  | { status: "renewed"; lease: LeaseRow }
  | { status: "lost"; reason: "not-found" | "not-active" | "not-owner" | "expired" }
> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const lease = await db.nonProductionEnvironmentLease.findUnique({
    where: { leaseId: input.leaseId },
  });
  if (!lease) return { status: "lost", reason: "not-found" };
  if (lease.status !== "active") return { status: "lost", reason: "not-active" };
  if (lease.ownerSessionId !== input.ownerSessionId) return { status: "lost", reason: "not-owner" };
  if (lease.expiresAt.getTime() <= now.getTime()) return { status: "lost", reason: "expired" };

  const ttlMs = admittedLeaseTtlMs(
    lease.environmentKey,
    input.ttlMs ?? DEFAULT_LEASE_TTL_MS,
  );
  const updated = await db.nonProductionEnvironmentLease.update({
    where: { leaseId: input.leaseId },
    data: {
      requestedTtlMs: ttlMs,
      expiresAt: new Date(now.getTime() + ttlMs),
      heartbeatAt: now,
      phase: "running",
    },
  });
  return { status: "renewed", lease: updated };
}

export async function reapExpiredNonprodEnvironmentLeases(input: {
  db?: LeaseDb;
  now?: Date;
} = {}): Promise<{ reaped: number }> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const lapsed = await db.nonProductionEnvironmentLease.findMany({
    where: {
      status: { in: ["active", "queued"] },
      expiresAt: { lt: now },
      releasedAt: null,
    },
    select: { id: true, environmentKey: true },
  });
  const environments = [...new Set(lapsed.map((row) => row.environmentKey))]
    .sort((left, right) => left.localeCompare(right));
  const promotedLeaseIds: string[] = [];
  for (const environmentKey of environments) {
    await inLeaseTransaction(db, async (tx) => {
      await lockEnvironment(tx, environmentKey);
      const result = await reconcileEnvironmentInTransaction({
        tx,
        environmentKey,
        now,
      });
      promotedLeaseIds.push(...result.admittedLeaseIds);
    });
  }
  const changedIds = [...new Set([
    ...lapsed.map((row) => row.id),
    ...promotedLeaseIds,
  ])];
  if (changedIds.length > 0) {
    const changed = await db.nonProductionEnvironmentLease.findMany({
      where: { id: { in: changedIds } },
    });
    const promoted = new Set(promotedLeaseIds);
    const transitions: LeaseTransitionInput[] = [];
    for (const lease of changed) {
      if (!promoted.has(lease.id)) {
        transitions.push({
          lease,
          transition: "cancelled",
          outcome: "failed",
          cycleMs: lease.queuedAt
            ? Math.max(0, now.getTime() - lease.queuedAt.getTime())
            : undefined,
        });
      }
    }
    for (const lease of changed) {
      if (promoted.has(lease.id)) {
        transitions.push({
          lease,
          transition: "started",
          waitMs: lease.queuedAt
            ? Math.max(0, now.getTime() - lease.queuedAt.getTime())
            : undefined,
        });
      }
    }
    void emitLeaseTransitions(transitions);
  }
  return { reaped: lapsed.length };
}
