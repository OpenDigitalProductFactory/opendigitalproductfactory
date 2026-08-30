import { randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";
import { planEnvironmentAdmission, type AdmissionLease } from "./environment-lease-admission";
import { type LocalCiHostPressure, type ResolvedLocalCiPoolPolicy } from "./local-ci-pool-policy";
import type { LocalCiCapacityBroker } from "./local-ci-capacity-broker";
import {
  resolveHostResourcePoolPolicy,
  resolveNonprodPoolPolicy,
  type HostResourceLeaseEvidence,
  type ResolvedHostResourcePoolPolicy,
} from "./environment-lease-pool-policy";
import { isHeavyResourceClass, type HeavyResourceClass } from "./host-resource-policy";
import localCiSlotResources from "./local-ci-slot-resources.json";
import { recordQueueTransition } from "@/lib/queue/queue-telemetry";
import { gateRunDispositionsTotal } from "@/lib/operate/metrics";
import type { NonprodOwnerProvider } from "./nonprod-owner-provider";
import { isImmutableGateClaimKey } from "@/lib/gates/gate-run-identity";
import { settleTerminalGateLease } from "./environment-lease-terminal-evidence";
import { admittedLeaseTtlMs, DEFAULT_LEASE_TTL_MS, requestedTtlMs } from "./environment-lease-timing";
import { afterNonprodLeaseRelease, publishNonprodCapacityForHead } from "./durable-wait";
export { NONPROD_OWNER_PROVIDERS, type NonprodOwnerProvider } from "./nonprod-owner-provider";
export {
  admittedLeaseTtlMs,
  clampLeaseExpiry,
  DEFAULT_LEASE_TTL_MS,
  HOST_RESOURCE_ACTIVE_LEASE_TTL_MS,
  LOCAL_CI_ACTIVE_LEASE_TTL_MS,
  MAX_LEASE_TTL_MS,
} from "./environment-lease-timing";
export {
  listActiveNonprodEnvironmentLeases,
  listCapacityReservingNonprodEnvironmentLeases,
  listQueuedNonprodEnvironmentLeases,
} from "./environment-lease-registry";

export type NonprodEnvironmentKey = "active-candidate" | "local-integration-ci" | "host-heavy-resource";
type NonprodSlotKey = keyof typeof localCiSlotResources.slots;
export const NONPROD_SLOT_KEYS = Object.freeze(Object.keys(localCiSlotResources.slots) as NonprodSlotKey[]);

function expectedLocalCiSlotBinding(slotKey: NonprodSlotKey) {
  const resources = localCiSlotResources.slots[slotKey];
  return {
    manifestVersion: localCiSlotResources.schemaVersion,
    slotKey,
    url: `http://localhost:${resources.portalPort}`,
    ports: [resources.portalPort, resources.postgresPort],
    cleanupCommand: `node scripts/local-ci-slot-cleanup.mjs --slot-key ${slotKey}`,
  };
}

type LeaseModel = typeof prisma.nonProductionEnvironmentLease;
type LeaseTx = Pick<
  typeof prisma,
  "$executeRaw" | "nonProductionEnvironmentLease" | "externalEvidenceRecord"
>;
type LeaseDb = Pick<typeof prisma, "nonProductionEnvironmentLease"> & Partial<Pick<
  typeof prisma, "$transaction" | "$executeRaw" | "platformConfig" | "externalEvidenceRecord"
>>;
type LeaseRow = NonNullable<Awaited<ReturnType<LeaseModel["findUnique"]>>>;

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
  slotKeys: string[];
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
    leases: rows.map((row) => ({
      ...(row as AdmissionLease),
      supportedSlotKeys:
        input.environmentKey === "local-integration-ci"
        && row.slotManifestVersion === 1
          ? [...NONPROD_SLOT_KEYS]
          : ["slot-0"],
    })),
    now: input.now,
    slotKeys: input.slotKeys,
  });

  if (plan.expiredLeaseIds.length > 0) {
    await input.tx.nonProductionEnvironmentLease.updateMany({
      where: { id: { in: plan.expiredLeaseIds } },
      data: {
        status: "expired",
        activeKey: null,
        phase: "expired",
        releasedAt: input.now,
        ownerPid: null,
        ownerProcessIdentity: null,
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
        phase: row?.slotManifestVersion === 1
          ? "admitted-unbound"
          : "admitted",
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

export type ClaimNonprodEnvironmentLeaseResult =
  | { status: "admitted"; lease: LeaseRow; slotKey: string; waitAgeMs: number; poolPolicy: ResolvedNonprodPoolPolicy }
  | { status: "queued"; lease: LeaseRow; queuePosition: number; waitAgeMs: number; poolPolicy: ResolvedNonprodPoolPolicy }
  | { status: "terminal"; lease: LeaseRow; reason: "released" | "expired" | "cancelled"; poolPolicy: ResolvedNonprodPoolPolicy }
  | { status: "subscribed"; lease: LeaseRow; executionStatus: "admitted" | "queued"; poolPolicy: ResolvedNonprodPoolPolicy }
  | { status: "reused"; lease: LeaseRow; evidenceRecordId: string; resultClass: "pass" | "fail"; poolPolicy: ResolvedNonprodPoolPolicy }
  | { status: "blocked"; lease: LeaseRow; reason: "missing-evidence" | "mismatched-evidence" | "expired-evidence"; poolPolicy: ResolvedNonprodPoolPolicy };

type ResolvedNonprodPoolPolicy = ResolvedLocalCiPoolPolicy | ResolvedHostResourcePoolPolicy;

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
  slotManifestVersion?: 1;
  hostPressure?: LocalCiHostPressure;
  capacityBroker?: LocalCiCapacityBroker;
  resourceClass?: HeavyResourceClass;
  expectedMemoryBytes?: number;
  ownerProcessId?: number;
  ownerProcessIdentity?: string;
  hostResource?: HostResourceLeaseEvidence;
  now?: Date;
}): Promise<ClaimNonprodEnvironmentLeaseResult> {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const sharedPoolPolicy = input.environmentKey === "host-heavy-resource"
    ? null
    : await resolveNonprodPoolPolicy({
      platformConfig: db.platformConfig,
      environmentKey: input.environmentKey,
      hostPressure: input.hostPressure,
      capacityBroker: input.capacityBroker,
      manifestSlotCount: NONPROD_SLOT_KEYS.length,
      // Only an exact local-CI runner claim consumes the declared builder and
      // host-stage envelopes. Contributor previews share this FIFO/provider
      // exclusion pool, but do not request a runner slot and must not reserve a
      // build stage they never execute.
      reserveAdmissionHeadroom: input.slotManifestVersion === 1,
      now,
    });
  if (
    input.environmentKey === "host-heavy-resource"
    && (!input.resourceClass || !input.expectedMemoryBytes || !input.hostResource)
  ) {
    throw new Error("host_resource_contract_required");
  }
  if (
    input.environmentKey !== "host-heavy-resource"
    && (input.resourceClass || input.expectedMemoryBytes || input.ownerProcessId || input.ownerProcessIdentity || input.hostResource)
  ) {
    throw new Error("host_resource_contract_wrong_environment");
  }
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

    const poolPolicy: ResolvedNonprodPoolPolicy = sharedPoolPolicy
      ?? resolveHostResourcePoolPolicy({
        resourceClass: input.resourceClass!,
        expectedMemoryBytes: input.expectedMemoryBytes!,
        hostResource: input.hostResource!,
        activeReservations: (await tx.nonProductionEnvironmentLease.findMany({
          where: {
            environmentKey: "host-heavy-resource",
            status: "active",
            expiresAt: { gt: now },
            ...(lease ? { id: { not: lease.id } } : {}),
          },
          select: { resourceClass: true, expectedMemoryBytes: true },
        })).flatMap((row) => {
          const resourceClass = String(row.resourceClass ?? "");
          const expectedMemoryBytes = Number(row.expectedMemoryBytes ?? 0);
          return isHeavyResourceClass(resourceClass) && expectedMemoryBytes > 0
            ? [{ resourceClass, expectedMemoryBytes }]
            : [];
        }),
      });

    if (
      lease
      && isTerminalLeaseStatus(lease.status)
      && isImmutableGateClaimKey(input.claimKey)
    ) {
      const settlement = await settleTerminalGateLease({
        tx,
        lease,
        claimKey: input.claimKey!,
        now,
        ttlMs,
      });
      if (settlement.kind === "settled") {
        return { ...settlement.projection, lease, poolPolicy };
      }
      lease = settlement.lease;
    }

    if (lease && isTerminalLeaseStatus(lease.status)) {
      return {
        status: "terminal",
        lease,
        reason: lease.status,
        poolPolicy,
      };
    }

    if (lease) {
      if (lease.environmentKey !== input.environmentKey) {
        throw new Error("nonprod_claim_key_environment_mismatch");
      }
      if (
        input.environmentKey === "host-heavy-resource"
        && (
          lease.resourceClass !== input.resourceClass
          || Number(lease.expectedMemoryBytes ?? 0) !== input.expectedMemoryBytes
          || lease.ownerPid !== input.ownerProcessId
          || lease.ownerProcessIdentity !== input.ownerProcessIdentity
        )
      ) {
        throw new Error("host_resource_claim_contract_mismatch");
      }
      if (lease.ownerSessionId !== input.ownerSessionId) {
        if (isImmutableGateClaimKey(input.claimKey)) {
          if (lease.status !== "active" && lease.status !== "queued") {
            throw new Error(`nonprod_claim_invalid_status:${lease.status}`);
          }
          return {
            status: "subscribed",
            lease,
            executionStatus: lease.status === "active" ? "admitted" : "queued",
            poolPolicy,
          };
        }
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
            ...(lease.slotManifestVersion === null
              && input.environmentKey === "local-integration-ci"
              && input.slotManifestVersion === 1
              ? { slotManifestVersion: 1 }
              : {}),
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
          resourceClass: input.resourceClass,
          expectedMemoryBytes: input.expectedMemoryBytes,
          ownerPid: input.ownerProcessId,
          ownerProcessIdentity: input.ownerProcessIdentity,
          slotManifestVersion: input.environmentKey === "local-integration-ci"
            ? input.slotManifestVersion
            : undefined,
        },
      });
      created = true;
    }

    const reconciliation = await reconcileEnvironmentInTransaction({
      tx,
      environmentKey: input.environmentKey,
      now,
      slotKeys: poolPolicy.slotKeys,
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
        poolPolicy,
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
        poolPolicy,
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
      poolPolicy,
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
  if (isImmutableGateClaimKey(input.claimKey)) {
    gateRunDispositionsTotal.inc({
      gate_kind: "local-integration-ci",
      disposition: result.status,
      result_class: result.status === "reused" ? result.resultClass : "none",
    });
  }
  return result;
}

export async function releaseNonprodEnvironmentLease(input: {
  db?: LeaseDb;
  leaseId: string;
  ownerSessionId?: string;
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
    if (
      isImmutableGateClaimKey(current.claimKey)
      && current.ownerSessionId !== input.ownerSessionId
    ) {
      throw new Error("nonprod_lease_not_owner");
    }
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
        ownerPid: null,
        ownerProcessIdentity: null,
      },
    });
    const reconciliation = await reconcileEnvironmentInTransaction({
      tx,
      environmentKey: current.environmentKey,
      now,
      // A local-CI waiter carries the fresh client-side host observation needed
      // to prove capacity. Preserve FIFO here and wake the durable queue head;
      // its one fresh claim can admit with current pressure evidence.
      slotKeys: current.environmentKey === "local-integration-ci"
        || current.environmentKey === "host-heavy-resource"
        ? []
        : ["slot-0"],
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
  await afterNonprodLeaseRelease({ db: db as never, lease: result.lease, priorStatus, now });
  return result.lease;
}

export async function renewNonprodEnvironmentLease(input: {
  db?: LeaseDb;
  leaseId: string;
  ownerSessionId: string;
  ttlMs?: number;
  slotBinding?: {
    manifestVersion: 1;
    slotKey: "slot-0" | "slot-1";
    url: string;
    ports: number[];
    cleanupCommand: string;
  };
  hostPressure?: LocalCiHostPressure;
  capacityBroker?: LocalCiCapacityBroker;
  now?: Date;
}): Promise<
  | {
    status: "renewed";
    lease: LeaseRow;
    poolPolicy: ResolvedNonprodPoolPolicy;
  }
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
  if (input.slotBinding) {
    const slotKey = lease.slotKey as NonprodSlotKey | null;
    if (
      !slotKey
      || !NONPROD_SLOT_KEYS.includes(slotKey)
      || lease.slotManifestVersion !== input.slotBinding.manifestVersion
      || slotKey !== input.slotBinding.slotKey
    ) {
      throw new Error("nonprod_slot_binding_mismatch");
    }
    const expected = expectedLocalCiSlotBinding(slotKey);
    if (
      input.slotBinding.manifestVersion !== expected.manifestVersion
      || input.slotBinding.url !== expected.url
      || input.slotBinding.cleanupCommand !== expected.cleanupCommand
      || input.slotBinding.ports.length !== expected.ports.length
      || input.slotBinding.ports.some(
        (port, index) => port !== expected.ports[index],
      )
    ) {
      throw new Error("nonprod_slot_resource_binding_mismatch");
    }
  } else if (
    lease.slotManifestVersion === 1
    && lease.phase === "admitted-unbound"
  ) {
    throw new Error("nonprod_slot_binding_required");
  }

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
      ...(input.slotBinding
        ? {
          url: input.slotBinding.url,
          ports: input.slotBinding.ports,
          cleanupCommand: input.slotBinding.cleanupCommand,
        }
        : {}),
    },
  });
  const poolPolicy: ResolvedNonprodPoolPolicy = lease.environmentKey === "host-heavy-resource"
    ? {
      policyVersion: 1,
      source: "host-resource-profile",
      requestedCapacity: 1,
      manifestCapacity: 1,
      hostSafeCapacity: 1,
      effectiveCapacity: 1,
      slotKeys: ["slot-0"],
      rollbackReason: null,
      config: null,
    }
    : await resolveNonprodPoolPolicy({
      platformConfig: db.platformConfig,
      environmentKey: lease.environmentKey,
      hostPressure: input.hostPressure,
      capacityBroker: input.capacityBroker,
      manifestSlotCount: NONPROD_SLOT_KEYS.length,
      reserveAdmissionHeadroom: false,
      now,
    });
  return { status: "renewed", lease: updated, poolPolicy };
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
        slotKeys: environmentKey === "local-integration-ci"
          || environmentKey === "host-heavy-resource"
          ? []
          : ["slot-0"],
      });
      promotedLeaseIds.push(...result.admittedLeaseIds);
    });
    await publishNonprodCapacityForHead({ db: db as never, environmentKey, causeLeaseId: `expired-${Math.floor(now.getTime() / 300_000)}`, now });
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
