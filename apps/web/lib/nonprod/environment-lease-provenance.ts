import type { prisma } from "@dpf/db";
import type { LeaseRow } from "./environment-lease-result";
import { checkpointFreshNonprodLeaseAdmission, deterministicNonprodWaitTaskRunId, parseNonprodLeaseWait } from "./durable-wait";
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
export async function ownsProcessFreePreview(input: {
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
