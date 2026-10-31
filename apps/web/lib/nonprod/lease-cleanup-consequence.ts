import type { ToolCallConsequence, ToolCallConsequenceInput } from "../tool-consequence";
import { ownsProcessFreeLease, type CleanupLease, type LeaseCleanupProofReader,
  type LeaseCleanupStance } from "./environment-lease-provenance";

type Reader = LeaseCleanupProofReader & {
  nonProductionEnvironmentLease: { findUnique(args: unknown): Promise<CleanupLease | null> };
};
const authority = (reason: string): ToolCallConsequence => ({ consequence: "authority", reason });

/** Consent and locked execution use the same current persisted ownership proof. */
export async function leaseCleanupConsequenceForCall(
  call: ToolCallConsequenceInput,
  deps: { db?: Reader; loadStance?: () => Promise<LeaseCleanupStance> } = {},
): Promise<ToolCallConsequence> {
  const leaseId = typeof call.params.leaseId === "string" ? call.params.leaseId.trim() : "";
  const session = typeof call.params.ownerSessionId === "string" ? call.params.ownerSessionId.trim() : "";
  if (call.toolName !== "release_nonprod_environment_lease" || !leaseId || !session || !call.userId
    || Object.keys(call.params).some(key => key !== "leaseId" && key !== "ownerSessionId")) {
    return authority("lease-cleanup-identity-unproven");
  }
  const db = deps.db ?? (await import("@dpf/db")).prisma as unknown as Reader;
  const lease = await db.nonProductionEnvironmentLease.findUnique({ where: { leaseId },
    select: { leaseId: true, claimKey: true, environmentKey: true, status: true,
      ownerProvider: true, ownerSessionId: true, worktreePath: true, branchName: true, taskRunId: true,
      slotManifestVersion: true, slotKey: true, activeKey: true, ownerPid: true, ownerProcessIdentity: true,
      cleanupCommand: true, resourceClass: true, expectedMemoryBytes: true, buildId: true, url: true, ports: true } });
  if (!lease || lease.leaseId !== leaseId) return authority("lease-cleanup-binding-unproven");
  const owned = await ownsProcessFreeLease({ db, lease, userId: call.userId, agentId: call.context?.agentId,
    ownerSessionId: session, loadStance: deps.loadStance });
  return owned ? { consequence: null, reason: lease.environmentKey === "active-candidate"
    ? "owned-development-preview-cleanup" : "owned-development-lease-cleanup" }
    : authority("lease-cleanup-binding-unproven");
}
