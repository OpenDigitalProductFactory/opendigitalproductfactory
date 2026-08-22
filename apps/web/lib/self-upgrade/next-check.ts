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

export function computeNextScheduledUpgradeCheckAt(args: {
  enabled: boolean;
  inMaintenanceWindow: boolean;
  nextWindowStart: Date | null;
  lastCheckedAt: Date | null;
  checkIntervalHours: number;
  now: Date;
}): Date | null {
  if (!args.enabled) return null;

  const intervalEligibleAt =
    args.lastCheckedAt && args.checkIntervalHours > 0
      ? new Date(args.lastCheckedAt.getTime() + args.checkIntervalHours * HOUR_MS)
      : args.now;
  if (!args.inMaintenanceWindow && !args.nextWindowStart) return null;

  const base = new Date(
    Math.max(
      args.now.getTime(),
      intervalEligibleAt.getTime(),
      args.inMaintenanceWindow
        ? args.now.getTime()
        : args.nextWindowStart?.getTime() ?? 0,
    ),
  );
  return nextHourlyCronAtOrAfter(base, args.now);
}
