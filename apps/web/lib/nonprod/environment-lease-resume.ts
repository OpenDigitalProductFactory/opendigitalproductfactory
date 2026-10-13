import { prisma } from "@dpf/db";

// BI-D35B85BF. A resumed local-CI gate names the lease it resumes
// (`resumeLeaseId`). Two defects lived here:
//
// - a cancelled `gate:` row was revived on the next claim, so an operator's
//   cancellation was undone by the resumer it was meant to stop (AC-DW-01);
// - when main moved, the same candidate re-claimed under a new integration
//   identity and the old queued row stayed queued until it expired, so one
//   waiter held two places in the queue (AC-DW-02).
//
// A new identity is still correct: incompatible evidence must never be reused
// (AC-DW-04). What changes is that the OBSOLETE queued wait is retired, and only
// when it is the same owner's and still only queued.

type LeaseModel = typeof prisma.nonProductionEnvironmentLease;
type LeaseRow = NonNullable<Awaited<ReturnType<LeaseModel["findUnique"]>>>;
type ResumeTx = Pick<typeof prisma, "nonProductionEnvironmentLease">;

/** Process handoff never changes the resource or owner contract. */
export function validateHostResourceClaim(lease: LeaseRow, input: {
  environmentKey: string; resumeLeaseId?: string; resourceClass?: string;
  expectedMemoryBytes?: number; ownerProvider: string; ownerProcessId?: number;
  ownerProcessIdentity?: string; worktreePath?: string; branchName?: string; purpose: string;
}): boolean {
  if (input.environmentKey !== "host-heavy-resource") return false;
  const resuming = input.resumeLeaseId === lease.leaseId && lease.status === "queued";
  if (lease.resourceClass !== input.resourceClass
    || Number(lease.expectedMemoryBytes ?? 0) !== input.expectedMemoryBytes
    || lease.ownerProvider !== input.ownerProvider
    || (resuming && (lease.worktreePath !== (input.worktreePath ?? null)
      || lease.branchName !== (input.branchName ?? null) || lease.purpose !== input.purpose))
    || (!resuming && (lease.ownerPid !== input.ownerProcessId
      || lease.ownerProcessIdentity !== input.ownerProcessIdentity))) {
    throw new Error("host_resource_claim_contract_mismatch");
  }
  return resuming;
}

/** Phase written on a queued wait retired by its own owner's replacement claim. */
export const SUPERSEDED_PHASE = "superseded";

export type ResumeClaimDecision =
  | { kind: "proceed"; superseded: LeaseRow | null }
  | { kind: "terminal"; lease: LeaseRow };

/**
 * Decide what a claim that resumes `resumeLeaseId` may do, inside the claim's
 * environment lock. `claimLease` is the row the claim key already resolves to.
 *
 * - The pinned lease was cancelled (not superseded): stop, create nothing.
 * - It is a different row (identity drifted) and still queued for this owner:
 *   retire it as superseded, then let the claim proceed.
 * - It is a different row that is running: refuse; never cancel an admitted run.
 * - It is a different row that belongs to another owner: refuse, change nothing.
 * - Unknown, expired, released or already superseded: proceed.
 */
export async function resolveResumeClaim(input: {
  tx: ResumeTx;
  resumeLeaseId: string | undefined;
  claimLease: LeaseRow | null;
  environmentKey: string;
  ownerSessionId: string;
  ownerProvider?: string;
  now: Date;
}): Promise<ResumeClaimDecision> {
  if (!input.resumeLeaseId) return { kind: "proceed", superseded: null };
  const pinned = await input.tx.nonProductionEnvironmentLease.findUnique({
    where: { leaseId: input.resumeLeaseId },
  });
  // A host attempt pins one invocation, not an integration tree that can be
  // superseded. Never create a replacement row or acquire another run's slot.
  if (input.environmentKey === "host-heavy-resource") {
    if (!pinned || pinned.environmentKey !== input.environmentKey
      || pinned.id !== input.claimLease?.id) throw new Error("nonprod_resume_identity_mismatch");
    if (pinned.ownerSessionId !== input.ownerSessionId
      || pinned.ownerProvider !== input.ownerProvider) throw new Error("nonprod_resume_not_owner");
    if (pinned.status === "active") throw new Error("nonprod_resume_lease_active");
    if (pinned.status !== "queued") return { kind: "terminal", lease: pinned };
    if (pinned.expiresAt <= input.now) throw new Error("nonprod_resume_lease_expired");
    return { kind: "proceed", superseded: null };
  }
  if (!pinned || pinned.environmentKey !== input.environmentKey) {
    return { kind: "proceed", superseded: null };
  }
  if (pinned.status === "cancelled" && pinned.phase !== SUPERSEDED_PHASE) {
    return { kind: "terminal", lease: pinned };
  }
  if (input.claimLease && input.claimLease.id === pinned.id) {
    return { kind: "proceed", superseded: null };
  }
  if (pinned.ownerSessionId !== input.ownerSessionId) {
    throw new Error("nonprod_resume_not_owner");
  }
  if (pinned.status === "active") {
    throw new Error("nonprod_resume_lease_active");
  }
  if (pinned.status !== "queued") return { kind: "proceed", superseded: null };
  const superseded = await input.tx.nonProductionEnvironmentLease.update({
    where: { id: pinned.id },
    data: {
      status: "cancelled",
      phase: SUPERSEDED_PHASE,
      cancelledAt: input.now,
      releasedAt: input.now,
      activeKey: null,
    },
  });
  return { kind: "proceed", superseded };
}
