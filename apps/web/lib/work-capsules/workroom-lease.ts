// Workroom lease ownership (BI-A7601AED, design 2026-10-07-durable-delegation-ledger-design.md §4.1).
//
// A lease says which principal is driving a room right now. Before this module
// a heartbeat wrote `leaseHolderPrincipalId = caller` unconditionally, and every
// evidence, activity and status write renewed the lease for whoever made it, so
// any participant silently took a live room from its holder (the class behind
// BI-A27B903D). Now:
//   - a renewal succeeds only for the holder, or for anyone once the lease has
//     lapsed or nobody holds it (the same rule `liveLeaseHeldByAnother` gives
//     scope claims, BI-2D65BD1B);
//   - a handover replaces the holder it read, under a row lock, and refuses when
//     the caller expected a different holder.

import { recordWorkCapsuleActivity as recordActivity } from "./work-capsule-activity-store";
import { leaseUntil } from "./work-capsule-branch-identity";
import { isWorkCapsuleExecutorKind, type WorkCapsuleExecutorKind } from "@/lib/work-capsules";
import { liveLeaseHeldByAnother } from "./scope-claim-lease";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

/** A renewal was refused because another principal holds a live lease. */
export class WorkroomLeaseHeldError extends Error {
  readonly code = "lease_held_by_other";
  constructor(
    readonly capsuleId: string,
    readonly holderPrincipalId: string,
    readonly leaseExpiresAt: Date,
  ) {
    super(
      `Another session holds ${capsuleId}'s lease until ${leaseExpiresAt.toISOString()}. `
        + "Wait for it to lapse, or ask the room's owner to hand it over with reassign_workroom_executor.",
    );
    this.name = "WorkroomLeaseHeldError";
  }
}

/** A handover named a holder that is no longer the room's holder. */
export class WorkroomLeaseHolderChangedError extends Error {
  readonly code = "lease_holder_changed";
  constructor(
    readonly capsuleId: string,
    readonly expectedHolderPrincipalId: string | null,
    readonly actualHolderPrincipalId: string | null,
  ) {
    super(
      `${capsuleId}'s lease holder changed (expected ${expectedHolderPrincipalId ?? "none"}, `
        + `found ${actualHolderPrincipalId ?? "none"}). Read the room again before handing it over.`,
    );
    this.name = "WorkroomLeaseHolderChangedError";
  }
}

const LEASE_SELECT = {
  id: true,
  capsuleId: true,
  executorKind: true,
  executorRef: true,
  leaseHolderPrincipalId: true,
  leaseExpiresAt: true,
} as const;

type LeaseRow = {
  id: string;
  capsuleId: string;
  executorKind: string | null;
  executorRef: string | null;
  leaseHolderPrincipalId: string | null;
  leaseExpiresAt: Date | null;
};

async function inTransaction<T>(db: CapsuleDb, fn: (tx: CapsuleDb) => Promise<T>): Promise<T> {
  return db.$transaction ? db.$transaction(fn) : fn(db);
}

/**
 * Lock the room's row for the rest of the transaction, then read its lease.
 * Isolated domain tests pass a CapsuleDb without `$queryRaw`; production's
 * Prisma transaction always has it, so two lease writers on one room queue.
 */
async function lockLease(tx: CapsuleDb, capsuleId: string): Promise<LeaseRow> {
  if (tx.$queryRaw) {
    await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "capsuleId" = ${capsuleId} FOR UPDATE`;
  }
  const row = (await tx.workroom.findUnique({ where: { capsuleId }, select: LEASE_SELECT })) as LeaseRow | null;
  if (!row) throw new Error(`Work Capsule ${capsuleId} not found`);
  return row;
}

/**
 * Renew the caller's lease. `onHeldByOther: "refuse"` (the heartbeat tool)
 * throws `WorkroomLeaseHeldError`; `"keep"` (the renewal that follows an
 * ordinary write) leaves the holder's lease untouched and returns the room.
 */
export async function heartbeatWorkCapsule(args: {
  db: CapsuleDb;
  capsuleId: string;
  actor: WorkCapsuleActor;
  now?: Date;
  onHeldByOther?: "refuse" | "keep";
}) {
  const now = args.now ?? new Date();
  const nextLease = leaseUntil(now);
  return inTransaction(args.db, async (tx) => {
    const current = await lockLease(tx, args.capsuleId);
    if (liveLeaseHeldByAnother(current, args.actor.principalId, now)) {
      if (args.onHeldByOther === "keep") return current;
      throw new WorkroomLeaseHeldError(
        args.capsuleId,
        current.leaseHolderPrincipalId as string,
        current.leaseExpiresAt as Date,
      );
    }
    const capsule = await tx.workroom.update({
      where: { capsuleId: args.capsuleId },
      data: {
        leaseHolderPrincipalId: args.actor.principalId,
        leaseExpiresAt: nextLease,
      },
    });
    await recordActivity(tx, {
      workCapsuleId: capsule.id,
      kind: "lease-renewed",
      summary: `Lease renewed until ${nextLease.toISOString()}`,
      actor: args.actor,
    });
    return capsule;
  });
}

/**
 * Cross-agent handoff (EP-WORK-CONVERGENCE / BI-A443B9CC): change the capsule's
 * executor, transfer the lease to the receiving principal, and record an
 * `executor-changed` activity carrying the full provenance + handoff manifest
 * (from/to executor, lease transfer, reason, next action / open risks / evidence
 * digest). This is the writer for the `executor-changed` activity kind, which
 * previously had zero writers. Renders as "Claude started this; Grok is
 * finishing it" — a plain status event, not raw agent plumbing.
 *
 * A handover is an authorised takeover (the governed access gate checked that
 * the person owns the room, BI-821EEB18), so it may replace a live holder; it
 * replaces the holder it read under the row lock, and when the caller passes
 * `expectedLeaseHolderPrincipalId` it refuses if that is no longer the holder.
 */
export async function reassignWorkCapsuleExecutor(args: {
  db: CapsuleDb;
  capsuleId: string;
  toExecutorKind: WorkCapsuleExecutorKind;
  toExecutorRef?: string | null;
  /** The receiving/acting principal — becomes the new lease holder. */
  actor: WorkCapsuleActor;
  reason?: string;
  /** next action, open risks, evidence digest, branch/worktree, suggested receiver. */
  handoffManifest?: Record<string, unknown>;
  /** The holder the caller read; `undefined` skips the check, `null` expects none. */
  expectedLeaseHolderPrincipalId?: string | null;
  now?: Date;
}) {
  if (!isWorkCapsuleExecutorKind(args.toExecutorKind)) {
    throw new Error("Invalid executor kind");
  }
  const nextLease = leaseUntil(args.now ?? new Date());
  return inTransaction(args.db, async (tx) => {
    const current = await lockLease(tx, args.capsuleId);
    if (
      args.expectedLeaseHolderPrincipalId !== undefined
      && args.expectedLeaseHolderPrincipalId !== current.leaseHolderPrincipalId
    ) {
      throw new WorkroomLeaseHolderChangedError(
        args.capsuleId,
        args.expectedLeaseHolderPrincipalId,
        current.leaseHolderPrincipalId,
      );
    }

    const updated = await tx.workroom.update({
      where: { capsuleId: args.capsuleId },
      data: {
        executorKind: args.toExecutorKind,
        executorRef: args.toExecutorRef ?? null,
        leaseHolderPrincipalId: args.actor.principalId,
        leaseExpiresAt: nextLease,
      },
    });

    await recordActivity(tx, {
      workCapsuleId: updated.id,
      kind: "executor-changed",
      summary: `Executor changed ${current.executorKind ?? "none"} → ${args.toExecutorKind}${args.reason ? `: ${args.reason}` : ""}`,
      payload: {
        fromExecutorKind: current.executorKind ?? null,
        fromExecutorRef: current.executorRef ?? null,
        toExecutorKind: args.toExecutorKind,
        toExecutorRef: args.toExecutorRef ?? null,
        fromLeaseHolderPrincipalId: current.leaseHolderPrincipalId ?? null,
        toLeaseHolderPrincipalId: args.actor.principalId,
        reason: args.reason ?? null,
        handoffManifest: args.handoffManifest ?? null,
      },
      actor: args.actor,
    });
    return updated;
  });
}
