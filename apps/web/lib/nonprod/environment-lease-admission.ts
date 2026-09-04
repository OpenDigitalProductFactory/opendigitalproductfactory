export type AdmissionLease = {
  id: string;
  status: string;
  slotKey: string | null;
  queuedAt: Date | null;
  expiresAt: Date;
  /** Last proof of life. Absent on legacy rows; `queuedAt` is the implicit first beat. */
  heartbeatAt?: Date | null;
  supportedSlotKeys?: string[];
};

export type EnvironmentAdmissionPlan = {
  expiredLeaseIds: string[];
  admissions: Array<{ leaseId: string; slotKey: string }>;
  queuePositions: Array<{ leaseId: string; position: number }>;
};

function queuedTimestamp(lease: AdmissionLease): number {
  return lease.queuedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function compareQueued(left: AdmissionLease, right: AdmissionLease): number {
  return queuedTimestamp(left) - queuedTimestamp(right)
    || left.id.localeCompare(right.id);
}

/**
 * Can this waiter still hold a slot, or only a place in line?
 *
 * BI-B1CB7EC3. A waiter proves it is attached to a process by re-claiming
 * (which stamps `heartbeatAt`). A waiter whose last beat is older than the
 * window could not have kept an ADMITTED lease alive either — admitting it
 * hands a slot to nobody, and the slot is dead until the TTL reaps it. Such a
 * waiter keeps its FIFO position (it is not expired) but may neither take a
 * slot nor block a younger waiter that is provably alive.
 */
export function waiterProvesLiveness(
  lease: AdmissionLease,
  now: Date,
  livenessWindowMs: number | undefined,
): boolean {
  if (livenessWindowMs === undefined) return true;
  const lastBeat = lease.heartbeatAt ?? lease.queuedAt ?? null;
  if (!lastBeat) return false;
  return now.getTime() - lastBeat.getTime() <= livenessWindowMs;
}

/**
 * Pure capacity reconciler for one governed nonproduction environment.
 *
 * PostgreSQL serializes the read/apply transaction; this function owns the
 * deterministic policy inside that transaction. Keeping policy pure makes FIFO
 * ordering and slot selection independently testable without weakening the
 * database uniqueness invariant.
 *
 * `admissibleLeaseIds` restricts WHO may be admitted on this pass without
 * changing WHO has precedence: a live older waiter outside the set still blocks
 * (it is woken by the durable queue and admits itself on its own next claim),
 * but a waiter is never promoted into a slot by a stranger's transaction.
 * Measured 2026-09-02 (BI-B1CB7EC3): 28 of 32 orphaned local-CI admissions were
 * promoted by another session's claim and never heartbeated.
 */
export function planEnvironmentAdmission(input: {
  leases: AdmissionLease[];
  now: Date;
  slotKeys: string[];
  livenessWindowMs?: number;
  admissibleLeaseIds?: string[];
}): EnvironmentAdmissionPlan {
  const slotKeys = [...new Set(input.slotKeys)].sort((left, right) =>
    left.localeCompare(right));
  const expiredLeaseIds = input.leases
    .filter((lease) =>
      (lease.status === "active" || lease.status === "queued")
      && lease.expiresAt.getTime() <= input.now.getTime())
    .map((lease) => lease.id)
    .sort((left, right) => left.localeCompare(right));
  const expired = new Set(expiredLeaseIds);
  const occupiedSlots = new Set(
    input.leases
      .filter((lease) =>
        lease.status === "active"
        && !expired.has(lease.id)
        && lease.slotKey)
      .map((lease) => lease.slotKey as string),
  );
  const freeSlots = slotKeys.filter((slotKey) => !occupiedSlots.has(slotKey));
  const waiting = input.leases
    .filter((lease) => lease.status === "queued" && !expired.has(lease.id))
    .sort(compareQueued);
  const admissible = input.admissibleLeaseIds
    ? new Set(input.admissibleLeaseIds)
    : null;
  const admissions: Array<{ leaseId: string; slotKey: string }> = [];
  for (const lease of waiting) {
    // A waiter without proof of life keeps its place but cannot hold or
    // block a slot on this pass.
    if (!waiterProvesLiveness(lease, input.now, input.livenessWindowMs)) continue;
    const supported = new Set(lease.supportedSlotKeys ?? slotKeys);
    const slotIndex = freeSlots.findIndex((slotKey) => supported.has(slotKey));
    // Preserve global FIFO. A later slot-aware waiter may not bypass an older
    // legacy waiter merely because the older client cannot consume slot-1.
    if (slotIndex < 0) break;
    // A live older waiter that is not the claimant keeps precedence: nobody is
    // admitted past it, and it is not admitted on a stranger's behalf.
    if (admissible && !admissible.has(lease.id)) break;
    const [slotKey] = freeSlots.splice(slotIndex, 1);
    admissions.push({ leaseId: lease.id, slotKey });
  }
  const admittedIds = new Set(admissions.map((entry) => entry.leaseId));
  const queuePositions = waiting
    .filter((lease) => !admittedIds.has(lease.id))
    .map((lease, index) => ({
      leaseId: lease.id,
      position: index + 1,
    }));

  return {
    expiredLeaseIds,
    admissions,
    queuePositions,
  };
}
