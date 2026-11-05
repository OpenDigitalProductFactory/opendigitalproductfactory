import { scheduledCheckEligibleAt } from "@/lib/self-upgrade/interval-anchor";

const HOUR_MS = 60 * 60 * 1000;

function nextHourlyCronAtOrAfter(base: Date, now: Date): Date {
  let candidate = new Date(base);
  candidate.setUTCMinutes(0, 0, 0);
  if (candidate.getTime() < base.getTime()) {
    candidate = new Date(candidate.getTime() + HOUR_MS);
  }
  if (candidate.getTime() <= now.getTime()) {
    candidate = new Date(candidate.getTime() + HOUR_MS);
  }
  return candidate;
}

/**
 * The hourly tick at which the scheduled cron is next expected to run a check.
 * The interval is anchored to the window opening (BI-EF1AC111,
 * interval-anchor.ts), the same rule the cron gate applies:
 *   - closed: the next opening, unless a longer-than-a-day interval holds it;
 *   - open: now, unless this opening already had its check; then the interval
 *     inside this opening or the start of the following opening, whichever is
 *     earlier.
 */
export function computeNextScheduledUpgradeCheckAt(args: {
  enabled: boolean;
  inMaintenanceWindow: boolean;
  nextWindowStart: Date | null;
  lastCheckedAt: Date | null;
  checkIntervalHours: number;
  now: Date;
  /** Start of the current opening, while open. Null: no bounded opening. */
  windowOpenedAt?: Date | null;
  /** Start of the opening after the current one, while open. */
  followingWindowStart?: Date | null;
}): Date | null {
  if (!args.enabled) return null;
  if (!args.inMaintenanceWindow && !args.nextWindowStart) return null;
  const nowMs = args.now.getTime();

  if (!args.inMaintenanceWindow) {
    const opensAt = args.nextWindowStart as Date;
    const eligible = scheduledCheckEligibleAt(args.lastCheckedAt, args.checkIntervalHours, opensAt);
    const base = Math.max(nowMs, opensAt.getTime(), eligible?.getTime() ?? 0);
    return nextHourlyCronAtOrAfter(new Date(base), args.now);
  }

  const eligible = scheduledCheckEligibleAt(
    args.lastCheckedAt,
    args.checkIntervalHours,
    args.windowOpenedAt ?? null,
  );
  let base = Math.max(nowMs, eligible?.getTime() ?? 0);
  const following = args.followingWindowStart ?? null;
  if (base > nowMs && following) {
    const followingEligible = scheduledCheckEligibleAt(args.lastCheckedAt, args.checkIntervalHours, following);
    base = Math.min(base, Math.max(following.getTime(), followingEligible?.getTime() ?? 0));
  }
  return nextHourlyCronAtOrAfter(new Date(base), args.now);
}
