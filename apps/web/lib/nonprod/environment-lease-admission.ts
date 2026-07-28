export type AdmissionLease = {
  id: string;
  status: string;
  slotKey: string | null;
  queuedAt: Date | null;
  expiresAt: Date;
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
 * Pure capacity reconciler for one governed nonproduction environment.
 *
 * PostgreSQL serializes the read/apply transaction; this function owns the
 * deterministic policy inside that transaction. Keeping policy pure makes FIFO
 * ordering and slot selection independently testable without weakening the
 * database uniqueness invariant.
 */
export function planEnvironmentAdmission(input: {
  leases: AdmissionLease[];
  now: Date;
  slotKeys: string[];
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
  const admissions = waiting
    .slice(0, freeSlots.length)
    .map((lease, index) => ({
      leaseId: lease.id,
      slotKey: freeSlots[index],
    }));
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
