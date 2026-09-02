import { prisma } from "@dpf/db";

type LeaseDb = Pick<typeof prisma, "nonProductionEnvironmentLease">;

export async function listActiveNonprodEnvironmentLeases(input: {
  db?: LeaseDb;
  now?: Date;
}) {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  return db.nonProductionEnvironmentLease.findMany({
    where: { status: "active", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
}

export async function listQueuedNonprodEnvironmentLeases(input: {
  db?: LeaseDb;
  now?: Date;
}) {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  return db.nonProductionEnvironmentLease.findMany({
    where: { status: "queued", expiresAt: { gt: now } },
    orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Grace over a lease's OWN declared TTL before we stop believing it is alive.
 *
 * A live waiter renews its heartbeat within its TTL — that is what the TTL is
 * for. Three missed renewals is not a slow host, it is a dead owner.
 */
const LIVENESS_GRACE_FACTOR = 3;

/** Floor for the liveness window, for a lease that declared an implausibly short TTL. */
const MIN_LIVENESS_WINDOW_MS = 120_000;

export type CapacityReservingLease = {
  heartbeatAt?: Date | null;
  queuedAt?: Date | null;
  createdAt?: Date | null;
  requestedTtlMs?: number | null;
};

/**
 * Does this lease still PROVE it is alive, or is it only still present?
 *
 * BI-DC9CA20D. Host-capacity arbitration used to count any row whose
 * `expiresAt` was in the future, which treats presence as liveness. Measured on
 * the live install 2026-09-02: six queued local-CI leases, ZERO active, every
 * one with `heartbeatAt` exactly equal to `queuedAt` — not a single renewal —
 * and staleness from 10 to 53 minutes. They were dead waiters whose sessions
 * had gone, and nothing was left to admit them.
 *
 * Because `local-provider-capacity` defers local inference whenever ANY lease
 * reserves the host, and because dead rows arrived (~1 per 7 min) far faster
 * than they expired, the queue could never empty: a permanent outage of the
 * platform's own AI, which is exactly the failure `contendsForInference`
 * already warns about for the preview case.
 *
 * The platform already holds this rule elsewhere and states it plainly —
 * Workroom liveness is "derived from lease/build/sync — never updatedAt". This
 * applies the same standard to host capacity: a reservation is only as good as
 * its last proof of life.
 */
export function leaseStillProvesLiveness(
  lease: CapacityReservingLease,
  now: Date,
): boolean {
  const declaredTtlMs = typeof lease.requestedTtlMs === "number"
    && Number.isFinite(lease.requestedTtlMs)
    && lease.requestedTtlMs > 0
    ? lease.requestedTtlMs
    : MIN_LIVENESS_WINDOW_MS;
  const windowMs = Math.max(declaredTtlMs * LIVENESS_GRACE_FACTOR, MIN_LIVENESS_WINDOW_MS);
  // queuedAt/createdAt are the implicit first beat: a row that has only just
  // been written has not had a chance to renew yet and must not be reaped.
  const lastBeat = lease.heartbeatAt ?? lease.queuedAt ?? lease.createdAt ?? null;
  if (!lastBeat) return false;
  return now.getTime() - lastBeat.getTime() <= windowMs;
}

/**
 * One snapshot for host-capacity arbitration across active and queued work.
 *
 * Only leases that still prove liveness reserve the host. A row that stopped
 * heartbeating stops reserving — see `leaseStillProvesLiveness`. This narrows
 * what counts as a reservation; it never widens it, so it cannot admit work
 * that arbitration would previously have refused.
 */
export async function listCapacityReservingNonprodEnvironmentLeases(input: {
  db?: LeaseDb;
  now?: Date;
}) {
  const db = input.db ?? prisma;
  const now = input.now ?? new Date();
  const rows = await db.nonProductionEnvironmentLease.findMany({
    where: {
      status: { in: ["active", "queued"] },
      expiresAt: { gt: now },
    },
    orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
  });
  return rows.filter((row) => leaseStillProvesLiveness(row, now));
}
