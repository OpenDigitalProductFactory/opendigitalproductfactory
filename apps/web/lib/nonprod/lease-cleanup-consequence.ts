import type { ToolCallConsequence, ToolCallConsequenceInput } from "../tool-consequence";
import { routineLeaseRelease, type CleanupLease, type LeaseCleanupProofReader } from "./environment-lease-provenance";

type Reader = LeaseCleanupProofReader & {
  nonProductionEnvironmentLease: { findUnique(args: unknown): Promise<CleanupLease | null> };
};
const authority = (reason: string, approverSummary?: string): ToolCallConsequence =>
  ({ consequence: "authority", reason, ...(approverSummary ? { approverSummary } : {}) });

/** What the person is deciding when a release still reaches them (BI-88D51B8F). */
function liveReservationSummary(lease: CleanupLease): string {
  const machine = lease.environmentKey === "active-candidate" ? "the shared preview portal" : "the shared test machine";
  const holder = [lease.ownerProvider, lease.branchName].filter(Boolean).join(" on ");
  return `This frees ${machine}, which another session${holder ? ` (${holder})` : ""} is still holding and renewing. `
    + "If that session is mid-run, the next queued test can start on top of it and both results become unreliable. "
    + "Approve only if you know that session is finished or stuck; otherwise its reservation ends by itself when it stops renewing.";
}

/** Consent and locked execution use the same current persisted proof. */
export async function leaseCleanupConsequenceForCall(
  call: ToolCallConsequenceInput,
  deps: { db?: Reader } = {},
): Promise<ToolCallConsequence> {
  const leaseId = typeof call.params.leaseId === "string" ? call.params.leaseId.trim() : "";
  const session = typeof call.params.ownerSessionId === "string" ? call.params.ownerSessionId.trim() : "";
  if (call.toolName !== "release_nonprod_environment_lease" || !leaseId || !call.userId
    || Object.keys(call.params).some(key => key !== "leaseId" && key !== "ownerSessionId")) {
    return authority("lease-cleanup-identity-unproven");
  }
  const db = deps.db ?? (await import("@dpf/db")).prisma as unknown as Reader;
  const lease = await db.nonProductionEnvironmentLease.findUnique({ where: { leaseId },
    select: { leaseId: true, claimKey: true, environmentKey: true, status: true,
      ownerProvider: true, ownerSessionId: true, worktreePath: true, branchName: true, taskRunId: true,
      slotManifestVersion: true, slotKey: true, activeKey: true, ownerPid: true, ownerProcessIdentity: true,
      cleanupCommand: true, resourceClass: true, expectedMemoryBytes: true, buildId: true, url: true, ports: true,
      expiresAt: true } });
  if (!lease || lease.leaseId !== leaseId) return authority("lease-cleanup-binding-unproven");
  const routine = await routineLeaseRelease({ db, lease, userId: call.userId, agentId: call.context?.agentId,
    ...(session ? { ownerSessionId: session } : {}), now: call.now ?? new Date() });
  if (routine === "owned-reservation") {
    return { consequence: null, reason: lease.environmentKey === "active-candidate"
      ? "owned-development-preview-cleanup" : "owned-development-lease-cleanup" };
  }
  if (routine) return { consequence: null, reason: routine };
  return authority("lease-cleanup-binding-unproven", liveReservationSummary(lease));
}
