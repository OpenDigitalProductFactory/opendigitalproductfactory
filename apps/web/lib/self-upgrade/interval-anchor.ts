// apps/web/lib/self-upgrade/interval-anchor.ts
//
// BI-EF1AC111. checkIntervalHours used to be measured from the last check of
// ANY kind, to the minute it ran. On an install with a nightly window:
//   - a daytime "Upgrade now" (13:48) pushed the next eligible scheduled check
//     to 13:48 the next day, after that night's window had closed, so the
//     night was skipped;
//   - a nightly run at 23:02 left 23h58m at the next night's 23:00 tick, so
//     the run drifted later each night until it fell out of the window.
//
// The interval is now anchored to the window: an opening that has not had a
// check yet forgives up to one day of the interval. With the default 24h (or
// anything shorter) every opening gets its check, whatever ran during the day.
// A longer interval (say weekly) is still honoured and lands on the opening
// nearest its due time. Within one opening the interval applies unchanged, so
// a long opening (a closed weekend, an always-open store) is polled no more
// often than configured.
//
// Pure and import-free: the cron gate, the status panel and the MCP status
// tool share this one rule, and test mocks of the DB readers cannot replace it.

const HOUR_MS = 60 * 60 * 1000;

/** How much of the interval a window opening with no check yet forgives. */
export const NEW_WINDOW_OPENING_GRACE_HOURS = 24;

/**
 * Earliest instant the interval lets the next scheduled check run, or null
 * when it does not throttle (never checked, or a non-positive interval).
 *
 * `windowOpenedAt` is the start of the opening the check would run in: the
 * current opening while the window is open, the next one while it is closed.
 * Null when there is no bounded opening (open across the whole scan horizon);
 * the interval then runs from the last check as before.
 */
export function scheduledCheckEligibleAt(
  lastCheckedAt: Date | null,
  intervalHours: number,
  windowOpenedAt: Date | null = null,
): Date | null {
  if (!lastCheckedAt) return null;
  if (!(intervalHours > 0)) return null;
  const openingNotYetChecked =
    windowOpenedAt !== null && lastCheckedAt.getTime() < windowOpenedAt.getTime();
  const forgivenHours = openingNotYetChecked
    ? Math.min(intervalHours, NEW_WINDOW_OPENING_GRACE_HOURS)
    : 0;
  return new Date(lastCheckedAt.getTime() + (intervalHours - forgivenHours) * HOUR_MS);
}

/** True when the interval lets a scheduled check run at `now`. */
export function isScheduledCheckDue(
  lastCheckedAt: Date | null,
  intervalHours: number,
  now: Date,
  windowOpenedAt: Date | null = null,
): boolean {
  const eligibleAt = scheduledCheckEligibleAt(lastCheckedAt, intervalHours, windowOpenedAt);
  return eligibleAt === null || now.getTime() >= eligibleAt.getTime();
}
