import { ownsProcessFreePreview, type PreviewLease } from "./environment-lease-provenance";
import type { ToolCallConsequence, ToolCallConsequenceInput } from "../tool-consequence";
import { deterministicNonprodWaitTaskRunId, parseNonprodLeaseWait } from "./durable-wait";

type Lease = PreviewLease & { slotManifestVersion: number | null };
type WaitTask = { taskRunId: string; userId: string; initiatingAgentId?: string | null; progressPayload: unknown };
type Reader = {
  nonProductionEnvironmentLease: { findUnique(args: unknown): Promise<Lease | null> };
  taskRun: { findUnique(args: unknown): Promise<WaitTask | null> };
};
type Stance = { environmentClass: string; primaryPurpose: string };

async function canonicalStance(): Promise<Stance> {
  const [{ prisma }, { loadInstanceStance, prismaInstanceStanceStore }] = await Promise.all([
    import("@dpf/db"), import("../install/instance-stance"),
  ]);
  return loadInstanceStance(prismaInstanceStanceStore(prisma));
}

const authority = (reason: string): ToolCallConsequence => ({ consequence: "authority", reason });

/** Narrow consent only; the existing governed executor and release transaction still enforce the call. */
export async function leaseCleanupConsequenceForCall(
  call: ToolCallConsequenceInput,
  deps: { db?: Reader; loadStance?: () => Promise<Stance> } = {},
): Promise<ToolCallConsequence> {
  const leaseId = typeof call.params.leaseId === "string" ? call.params.leaseId.trim() : "";
  const session = typeof call.params.ownerSessionId === "string" ? call.params.ownerSessionId.trim() : "";
  if (call.toolName !== "release_nonprod_environment_lease" || !leaseId || !session || !call.userId
    || Object.keys(call.params).some((key) => key !== "leaseId" && key !== "ownerSessionId")) {
    return authority("lease-cleanup-identity-unproven");
  }
  const stance = await (deps.loadStance ?? canonicalStance)();
  if (stance.environmentClass !== "development" || stance.primaryPurpose !== "evolve-dpf") {
    return authority("lease-cleanup-outside-development");
  }
  const db = deps.db ?? (await import("@dpf/db")).prisma as unknown as Reader;
  const lease = await db.nonProductionEnvironmentLease.findUnique({
    where: { leaseId },
    select: { leaseId: true, claimKey: true, environmentKey: true, status: true,
      ownerProvider: true, ownerSessionId: true, worktreePath: true, branchName: true,
      taskRunId: true, slotManifestVersion: true, slotKey: true, activeKey: true,
      ownerPid: true, ownerProcessIdentity: true, cleanupCommand: true, resourceClass: true,
      expectedMemoryBytes: true, buildId: true, url: true, ports: true },
  });
  if (lease?.leaseId === leaseId && lease.environmentKey === "active-candidate") {
    const owned = await ownsProcessFreePreview({ db, lease, userId: call.userId,
      agentId: call.context?.agentId, ownerSessionId: session, loadStance: deps.loadStance ?? canonicalStance });
    return owned ? { consequence: null, reason: "owned-development-preview-cleanup" }
      : authority("preview-ownership-unproven");
  }
  if (!lease || lease.leaseId !== leaseId || lease.ownerSessionId !== session
    || lease.environmentKey !== "local-integration-ci" || lease.slotManifestVersion !== 1
    || !lease.claimKey || !lease.taskRunId || !lease.worktreePath || !lease.branchName
    || lease.ownerPid !== null || lease.ownerProcessIdentity !== null
    || !["queued", "active", "released", "cancelled", "expired"].includes(lease.status)) {
    return authority("lease-cleanup-binding-unproven");
  }
  // The task identifier includes the authenticated original user and exact lease.
  if (lease.taskRunId !== deterministicNonprodWaitTaskRunId(call.userId, leaseId)) {
    return authority("lease-cleanup-foreign-user");
  }
  const task = await db.taskRun.findUnique({
    where: { taskRunId: lease.taskRunId },
    select: { taskRunId: true, userId: true, progressPayload: true },
  });
  const wait = parseNonprodLeaseWait(task?.progressPayload);
  if (!task || task.userId !== call.userId || task.taskRunId !== lease.taskRunId || !wait
    || wait.leaseId !== lease.leaseId || wait.claimKey !== lease.claimKey
    || wait.environmentKey !== lease.environmentKey || wait.ownerProvider !== lease.ownerProvider
    || wait.ownerSessionId !== session || wait.worktreePath !== lease.worktreePath
    || wait.branchName !== lease.branchName) {
    return authority("lease-cleanup-wait-provenance-unproven");
  }
  if ((lease.status === "active" && (wait.state !== "admitted"
    || !["slot-0", "slot-1"].includes(lease.slotKey ?? "")
    || lease.activeKey !== `${lease.environmentKey}:${lease.slotKey}`))
    || (lease.status === "queued" && !["waiting", "capacity-available"].includes(wait.state))) {
    return authority("lease-cleanup-state-inconsistent");
  }
  return { consequence: null, reason: "owned-development-lease-cleanup" };
}
