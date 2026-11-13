// Transaction, lock and queue-telemetry helpers for nonprod environment leases.
// Split from environment-lease.ts to keep that module under the size ratchet
// (BI-218A4555); behaviour is unchanged.
import type { prisma } from "@dpf/db";
import { recordQueueTransition } from "@/lib/queue/queue-telemetry";
import { lockNonprodEnvironment } from "./environment-lease-lock";
import type { LeaseRow } from "./environment-lease-result";

export type LeaseTx = Pick<
  typeof prisma,
  "$executeRaw" | "$queryRaw" | "nonProductionEnvironmentLease" | "externalEvidenceRecord" | "workroom"
> & Partial<Pick<typeof prisma, "taskRun">>;
export type LeaseDb = Pick<typeof prisma, "nonProductionEnvironmentLease"> & Partial<Pick<
  typeof prisma, "$transaction" | "$executeRaw" | "platformConfig" | "externalEvidenceRecord" | "workroom" | "taskRun"
>>;

export async function inLeaseTransaction<T>(
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

/**
 * Lanes whose queue head is WOKEN, never promoted: the head's own next claim is
 * the only transaction that may admit it.
 */
export function isSelfAdmittingEnvironment(environmentKey: string): boolean {
  return environmentKey === "local-integration-ci"
    || environmentKey === "host-heavy-resource";
}

export type LeaseTransitionInput = {
  lease: LeaseRow;
  transition: "enqueued" | "started" | "finished" | "cancelled";
  outcome?: "success" | "failed" | "cancelled";
  depth?: number;
  waitMs?: number;
  processMs?: number;
  cycleMs?: number;
};

export function emitLeaseTransition(input: LeaseTransitionInput) {
  return recordQueueTransition({
    queueKey: `compute:nonprod-${input.lease.environmentKey}`,
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

export async function emitLeaseTransitions(inputs: LeaseTransitionInput[]) {
  for (const input of inputs) {
    await emitLeaseTransition(input);
  }
}

export async function lockEnvironment(
  tx: LeaseTx,
  environmentKey: string,
): Promise<void> {
  if (typeof tx.$executeRaw !== "function") return;
  await lockNonprodEnvironment(tx, environmentKey);
}
