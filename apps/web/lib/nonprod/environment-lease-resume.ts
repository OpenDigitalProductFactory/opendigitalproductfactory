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
  now: Date;
}): Promise<ResumeClaimDecision> {
  if (!input.resumeLeaseId) return { kind: "proceed", superseded: null };
  const pinned = await input.tx.nonProductionEnvironmentLease.findUnique({
    where: { leaseId: input.resumeLeaseId },
  });
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
