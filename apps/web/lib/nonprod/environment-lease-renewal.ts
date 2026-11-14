import { inLeaseTransaction, lockEnvironment, type LeaseDb } from "./environment-lease-transaction";
import type { LeaseRow } from "./environment-lease-result";
import { assertRenewalSlotBinding, type NonprodSlotBinding } from "./environment-lease-slot-binding";
import { admittedLeaseTtlMs, DEFAULT_LEASE_TTL_MS } from "./environment-lease-timing";
import { decideRenewalHoldBound } from "./environment-lease-hold-bound";
import { boundedRenewalExpiry, type HoldClass } from "./environment-lease-overseer";

type RenewalWrite =
  | { status: "renewed"; lease: LeaseRow; environmentKey: string; renewedAt: Date }
  | { status: "lost"; reason: "not-found" | "not-active" | "not-owner" | "expired" }
  | { status: "lost"; reason: "yielded"; holdClass: HoldClass; holdBoundAt: Date };

/** Same serialization boundary as expiry, release and admission. No external I/O. */
export async function renewLeaseWithEnvironmentLock(input: {
  db: LeaseDb; leaseId: string; ownerSessionId: string; ttlMs?: number;
  slotBinding?: NonprodSlotBinding; now?: Date;
}): Promise<RenewalWrite> {
  // This read locates the lock only. It never supplies renewal authority.
  const observed = await input.db.nonProductionEnvironmentLease.findUnique({
    where: { leaseId: input.leaseId },
  });
  if (!observed) return { status: "lost", reason: "not-found" };
  return inLeaseTransaction(input.db, async tx => {
    await lockEnvironment(tx, observed.environmentKey);
    const now = input.now ?? new Date();
    const lease = await tx.nonProductionEnvironmentLease.findUnique({ where: { leaseId: input.leaseId } });
    if (!lease) return { status: "lost", reason: "not-found" };
    if (lease.id !== observed.id || lease.environmentKey !== observed.environmentKey || lease.status !== "active") {
      return { status: "lost", reason: "not-active" };
    }
    if (lease.ownerSessionId !== input.ownerSessionId) return { status: "lost", reason: "not-owner" };
    if (lease.expiresAt.getTime() <= now.getTime()) return { status: "lost", reason: "expired" };
    const holdBound = await decideRenewalHoldBound(tx, lease, now);
    if (holdBound.kind === "yield") {
      await tx.nonProductionEnvironmentLease.update({ where: { leaseId: input.leaseId }, data: { phase: holdBound.phase } });
      return { status: "lost", reason: "yielded", holdClass: holdBound.classification.holdClass, holdBoundAt: holdBound.holdBoundAt };
    }
    if (input.slotBinding) assertRenewalSlotBinding(lease, input.slotBinding);
    else if (lease.slotManifestVersion === 1 && lease.phase === "admitted-unbound") {
      throw new Error("nonprod_slot_binding_required");
    }
    const ttlMs = admittedLeaseTtlMs(lease.environmentKey, input.ttlMs ?? DEFAULT_LEASE_TTL_MS);
    const updated = await tx.nonProductionEnvironmentLease.update({
      where: { leaseId: input.leaseId },
      data: {
        requestedTtlMs: ttlMs,
        expiresAt: boundedRenewalExpiry(holdBound, new Date(now.getTime() + ttlMs)),
        heartbeatAt: now, phase: "running",
        ...(input.slotBinding ? {
          url: input.slotBinding.url, ports: input.slotBinding.ports, cleanupCommand: input.slotBinding.cleanupCommand,
        } : {}),
      },
    });
    return { status: "renewed", lease: updated, environmentKey: lease.environmentKey, renewedAt: now };
  });
}
