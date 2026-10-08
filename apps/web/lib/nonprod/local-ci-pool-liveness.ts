/**
 * Local-CI pool liveness (BI-277ECBDB, part C).
 *
 * On 2026-09-02 a host restart killed the slot databases. Six leases cycled
 * through local-integration-ci for an hour and produced zero results, and
 * nothing anywhere said so: every session saw "queued" and waited. Admissions
 * without results over a window is trivially detectable, so this measures it.
 *
 * A lease counts as COMPLETED when a result was recorded against it
 * (`evidenceRecordId`, set by recordLocalIntegrationResult whatever the
 * verdict). It counts as ADMITTED WITHOUT RESULT when it was admitted inside
 * the window and has ended without one. A lease still in flight counts as
 * neither, and a claim that was never admitted (a cancelled or expired wait) is
 * not an admission. The pool is degraded when admissions keep ending without a
 * result and nothing in the window completed. One completion proves the pool
 * can still grade a diff.
 */

export const LOCAL_CI_POOL_STALLED_ISSUE_KEY = "local-ci:pool-admissions-without-results";
export const LOCAL_CI_LIVENESS_WINDOW_MS = 90 * 60_000;
export const LOCAL_CI_LIVENESS_MIN_STALLED = 3;

export type LocalCiLeaseLivenessRow = {
  leaseId: string;
  admittedAt: Date | null;
  releasedAt: Date | null;
  evidenceRecordId: string | null;
  status: string;
};

export type LocalCiPoolLiveness = {
  degraded: boolean;
  windowMs: number;
  completed: number;
  admittedWithoutResult: number;
  stalledLeaseIds: string[];
  summary: string;
};

const ENDED_STATUSES = new Set(["released", "expired", "cancelled"]);

export function assessLocalCiPoolLiveness(input: {
  leases: LocalCiLeaseLivenessRow[];
  now: Date;
  windowMs?: number;
  minStalled?: number;
}): LocalCiPoolLiveness {
  const windowMs = input.windowMs ?? LOCAL_CI_LIVENESS_WINDOW_MS;
  const minStalled = input.minStalled ?? LOCAL_CI_LIVENESS_MIN_STALLED;
  const since = input.now.getTime() - windowMs;
  let completed = 0;
  const stalledLeaseIds: string[] = [];
  for (const lease of input.leases) {
    if (!lease.admittedAt || lease.admittedAt.getTime() < since) continue;
    if (lease.evidenceRecordId) {
      completed += 1;
      continue;
    }
    const ended = lease.releasedAt !== null || ENDED_STATUSES.has(lease.status);
    if (ended) stalledLeaseIds.push(lease.leaseId);
  }
  const minutes = Math.round(windowMs / 60_000);
  const degraded = completed === 0 && stalledLeaseIds.length >= minStalled;
  return {
    degraded,
    windowMs,
    completed,
    admittedWithoutResult: stalledLeaseIds.length,
    stalledLeaseIds,
    summary: degraded
      ? `${stalledLeaseIds.length} local-CI admissions in the last ${minutes} minutes ended with no recorded result, and none completed. `
        + "The pool is admitting work it cannot grade (check the slot PostgreSQL containers and Docker), so queued gates are waiting on a broken pool, not on other work."
      : `${completed} completed and ${stalledLeaseIds.length} ended without a result in the last ${minutes} minutes.`,
  };
}
