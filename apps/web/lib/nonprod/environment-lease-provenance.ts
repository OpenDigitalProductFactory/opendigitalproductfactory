import { randomUUID } from "node:crypto";
import type { prisma } from "@dpf/db";
import type { ClaimNonprodEnvironmentLeaseResult, LeaseRow } from "./environment-lease-result";
import { checkpointFreshNonprodLeaseAdmission, checkpointNonprodLeaseWait, deterministicNonprodWaitTaskRunId, parseNonprodLeaseWait } from "./durable-wait";
import { isRecord } from "../shared/coerce";

export type CleanupLease = Pick<LeaseRow, "leaseId" | "claimKey" | "environmentKey" | "ownerProvider" | "ownerSessionId"
  | "worktreePath" | "branchName" | "buildId" | "url" | "ports" | "taskRunId" | "status" | "slotKey" | "activeKey"
  | "ownerPid" | "ownerProcessIdentity" | "cleanupCommand" | "resourceClass" | "expectedMemoryBytes" | "slotManifestVersion">;
export type LeaseCleanupStance = { environmentClass: string; primaryPurpose: string };
export type LeaseCleanupProofReader = { taskRun?: { findUnique(args: unknown): Promise<{
  taskRunId: string; userId: string; initiatingAgentId?: string | null; progressPayload: unknown;
} | null> } };

function previewBinding(lease: CleanupLease): Record<string, unknown> {
  return { leaseId: lease.leaseId, claimKey: lease.claimKey, environmentKey: lease.environmentKey,
    ownerProvider: lease.ownerProvider, ownerSessionId: lease.ownerSessionId,
    worktreePath: lease.worktreePath, branchName: lease.branchName, buildId: lease.buildId,
    url: lease.url, ports: lease.ports };
}

export async function loadLeaseCleanupStance(): Promise<LeaseCleanupStance> {
  const [{ prisma }, { loadInstanceStance, prismaInstanceStanceStore }] = await Promise.all([
    import("@dpf/db"), import("../install/instance-stance"),
  ]);
  return loadInstanceStance(prismaInstanceStanceStore(prisma));
}

/** One predicate for consent and locked execution. No ownership is inferred or repaired here. */
async function previewWaitMatchesOwner(input: {
  db: LeaseCleanupProofReader; lease: CleanupLease; userId?: string; agentId?: string; ownerSessionId?: string;
  loadStance?: () => Promise<LeaseCleanupStance>;
}): Promise<boolean> {
  const { lease, userId, agentId } = input;
  if (!userId || !agentId || !input.ownerSessionId || !input.db.taskRun
    || lease.environmentKey !== "active-candidate" || lease.ownerSessionId !== input.ownerSessionId
    || lease.ownerPid !== null || lease.ownerProcessIdentity !== null || lease.cleanupCommand !== null
    || lease.resourceClass !== null || lease.expectedMemoryBytes !== null
    || !["active", "queued", "released", "cancelled", "expired"].includes(lease.status)
    || lease.taskRunId !== deterministicNonprodWaitTaskRunId(userId, lease.leaseId)) return false;
  const task = await input.db.taskRun.findUnique({ where: { taskRunId: lease.taskRunId },
    select: { taskRunId: true, userId: true, initiatingAgentId: true, progressPayload: true } });
  const progress = isRecord(task?.progressPayload) ? task.progressPayload : null;
  const owner = isRecord(progress?.nonprodPreviewOwner) ? progress.nonprodPreviewOwner : null;
  const binding = isRecord(owner?.binding) ? owner.binding : null;
  const wait = parseNonprodLeaseWait(progress);
  if (!task || task.userId !== userId || task.initiatingAgentId !== agentId || task.taskRunId !== lease.taskRunId
    || owner?.schemaVersion !== 1 || owner.userId !== userId || owner.agentId !== agentId || !binding || !wait
    || Object.entries(previewBinding(lease)).some(([key, value]) => JSON.stringify(binding[key]) !== JSON.stringify(value))
    || wait.leaseId !== lease.leaseId || wait.claimKey !== lease.claimKey || wait.environmentKey !== lease.environmentKey
    || wait.ownerProvider !== lease.ownerProvider || wait.ownerSessionId !== lease.ownerSessionId
    || wait.worktreePath !== lease.worktreePath || wait.branchName !== lease.branchName) return false;
  if (lease.status === "active" && (wait.state !== "admitted" || lease.slotKey !== "slot-0"
    || lease.activeKey !== "active-candidate:slot-0")) return false;
  if (lease.status === "queued" && (!["waiting", "capacity-available"].includes(wait.state)
    || lease.slotKey !== null || lease.activeKey !== null)) return false;
  if (["released", "cancelled", "expired"].includes(lease.status) && lease.activeKey !== null) return false;
  return true;
}

async function ownsProcessFreePreview(input: Parameters<typeof previewWaitMatchesOwner>[0]): Promise<boolean> {
  if (!await previewWaitMatchesOwner(input)) return false;
  const stance = await (input.loadStance ?? loadLeaseCleanupStance)();
  return stance.environmentClass === "development" && stance.primaryPurpose === "evolve-dpf";
}

/** The existing CI proof and fresh preview proof share one execution boundary.
 * A changed environment must not select an unchecked legacy branch. */
export async function ownsProcessFreeLease(input: {
  db: LeaseCleanupProofReader; lease: CleanupLease; userId?: string; agentId?: string; ownerSessionId?: string;
  loadStance?: () => Promise<LeaseCleanupStance>;
}): Promise<boolean> {
  const { lease, userId } = input;
  if (lease.environmentKey === "active-candidate") return ownsProcessFreePreview(input);
  if (!userId || !input.ownerSessionId || !input.db.taskRun
    || lease.environmentKey !== "local-integration-ci" || lease.slotManifestVersion !== 1
    || lease.ownerSessionId !== input.ownerSessionId || !lease.claimKey || !lease.worktreePath || !lease.branchName
    || lease.ownerPid !== null || lease.ownerProcessIdentity !== null
    || !["queued", "active", "released", "cancelled", "expired"].includes(lease.status)
    || lease.taskRunId !== deterministicNonprodWaitTaskRunId(userId, lease.leaseId)) return false;
  const task = await input.db.taskRun.findUnique({ where: { taskRunId: lease.taskRunId },
    select: { taskRunId: true, userId: true, progressPayload: true } });
  const wait = parseNonprodLeaseWait(task?.progressPayload);
  if (!task || task.userId !== userId || task.taskRunId !== lease.taskRunId || !wait
    || (isRecord(task.progressPayload) && task.progressPayload.nonprodPreviewOwner !== undefined)
    || wait.leaseId !== lease.leaseId || wait.claimKey !== lease.claimKey || wait.environmentKey !== lease.environmentKey
    || wait.ownerProvider !== lease.ownerProvider || wait.ownerSessionId !== lease.ownerSessionId
    || wait.worktreePath !== lease.worktreePath || wait.branchName !== lease.branchName) return false;
  if ((lease.status === "active" && (wait.state !== "admitted"
    || !["slot-0", "slot-1"].includes(lease.slotKey ?? "")
    || lease.activeKey !== `${lease.environmentKey}:${lease.slotKey}`))
    || (lease.status === "queued" && !["waiting", "capacity-available"].includes(wait.state))) return false;
  const stance = await (input.loadStance ?? loadLeaseCleanupStance)();
  return stance.environmentClass === "development" && stance.primaryPurpose === "evolve-dpf";
}

/** Reserved server execution context; none of these fields are public tool arguments. */
export type LeaseReleaseContext = {
  authenticatedUserId?: string; authenticatedAgentId?: string;
  approvedAuthorityEnvelopeId?: string | null;
  loadStance?: () => Promise<LeaseCleanupStance>;
};

export async function assertOwnedLeaseRelease(input: LeaseReleaseContext & {
  db: LeaseCleanupProofReader; lease: CleanupLease; ownerSessionId?: string;
}): Promise<void> {
  if (!input.authenticatedAgentId || input.approvedAuthorityEnvelopeId) return;
  const owned = await ownsProcessFreeLease({ db: input.db, lease: input.lease,
    userId: input.authenticatedUserId, agentId: input.authenticatedAgentId,
    ownerSessionId: input.ownerSessionId, loadStance: input.loadStance }).catch(() => false);
  if (!owned) throw new Error("nonprod_lease_cleanup_ownership_unproven");
}

/** Fresh admission transaction only. Never backfill a legacy lease or adopt a caller Task. */
export async function bindFreshLeaseProvenance(input: {
  db: Pick<typeof prisma, "nonProductionEnvironmentLease"> & Partial<Pick<typeof prisma, "taskRun">>;
  lease: LeaseRow; created: boolean; authenticatedUserId?: string; authenticatedAgentId?: string;
  queuePosition?: number; waitDeadlineAt: Date; now: Date;
}): Promise<LeaseRow> {
  const { lease } = input;
  if (!input.created || !input.authenticatedUserId || lease.taskRunId) return lease;
  const preview = lease.environmentKey === "active-candidate" && !!input.authenticatedAgentId
    && ["active", "queued"].includes(lease.status);
  const localCi = lease.environmentKey === "local-integration-ci" && lease.slotManifestVersion === 1
    && lease.status === "active" && !!lease.slotKey;
  if (!preview && !localCi) return lease;
  if (!input.db.taskRun) throw new Error("nonprod_immediate_admission_task_store_unavailable");
  const taskRunId = await checkpointFreshNonprodLeaseAdmission({
    db: { nonProductionEnvironmentLease: input.db.nonProductionEnvironmentLease, taskRun: input.db.taskRun },
    userId: input.authenticatedUserId, lease, waitDeadlineAt: input.waitDeadlineAt, now: input.now,
    ...(preview ? { previewOwner: { schemaVersion: 1, userId: input.authenticatedUserId,
      agentId: input.authenticatedAgentId!, binding: previewBinding(lease) }, queuePosition: input.queuePosition } : {}),
  });
  return { ...lease, taskRunId };
}

/** Called under the lease lock. This result is internal, never copied from tool parameters. */
type QueuedCheckpoint = Pick<Extract<ClaimNonprodEnvironmentLeaseResult, { status: "queued" }>,
  "lease" | "durableWaitTaskRunId">;

export async function checkpointQueuedLeaseProvenance(
  input: Parameters<typeof bindFreshLeaseProvenance>[0],
): Promise<QueuedCheckpoint> {
  const lease = await bindFreshLeaseProvenance(input);
  const legacy = { lease };
  if (lease.environmentKey !== "active-candidate" || !input.authenticatedUserId
    || !input.authenticatedAgentId || !lease.taskRunId) return legacy;
  if (input.created) {
    return input.lease.taskRunId === null ? { lease, durableWaitTaskRunId: lease.taskRunId } : legacy;
  }
  if (!input.db.taskRun) throw new Error("nonprod_preview_ownership_store_unavailable");
  const linked = await input.db.taskRun.findUnique({ where: { taskRunId: lease.taskRunId },
    select: { progressPayload: true } });
  const progress = isRecord(linked?.progressPayload) ? linked.progressPayload : null;
  if (progress?.nonprodPreviewOwner === undefined) return legacy;
  if (!await previewWaitMatchesOwner({ db: input.db as never, lease, userId: input.authenticatedUserId,
    agentId: input.authenticatedAgentId, ownerSessionId: lease.ownerSessionId })) {
    throw new Error("nonprod_preview_ownership_conflict");
  }
  const wait = await checkpointNonprodLeaseWait({ db: input.db as never, userId: input.authenticatedUserId,
    lease, queuePosition: input.queuePosition!, waitDeadlineAt: input.waitDeadlineAt, now: input.now });
  return { lease, durableWaitTaskRunId: wait.taskRunId };
}


/** The ORM may supply its own creation time even when the field is omitted.
 * Only the exact transaction's database clock satisfies the birth invariant. */
export async function freshLeaseBirthFields(
  tx: Partial<Pick<typeof prisma, "$queryRaw">>,
): Promise<{ leaseId: string; createdAt?: Date }> {
  const leaseId = `NPEL-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  // Legacy narrow domain ports cannot assert positive history.
  if (typeof tx.$queryRaw !== "function") return { leaseId };
  const rows = await tx.$queryRaw<Array<{ createdAt: Date }>>`SELECT CURRENT_TIMESTAMP::timestamp(3) AS "createdAt"`;
  const createdAt = Array.isArray(rows) && rows.length === 1 ? rows[0]?.createdAt : null;
  if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
    throw new Error("nonprod_lease_birth_clock_unavailable");
  }
  return { leaseId, createdAt };
}
