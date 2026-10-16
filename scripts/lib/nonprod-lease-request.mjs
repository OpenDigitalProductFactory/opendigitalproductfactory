/** Explicit relative timing; legacy servers still receive a bounded absolute fallback. */
export function leaseRequestTiming({ now, durationMs, deadline }) {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 1_200_000) {
    throw new Error("Lease duration must be positive and at most twenty minutes.");
  }
  const start = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(deadline) || deadline <= start) {
    throw new Error("Lease admission deadline must still be in the future.");
  }
  return {
    expiresAt: new Date(start + durationMs).toISOString(),
    requestedTtlMs: durationMs,
    waitDeadlineAt: new Date(deadline).toISOString(),
  };
}
