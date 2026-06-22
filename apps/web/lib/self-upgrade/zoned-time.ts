// apps/web/lib/self-upgrade/zoned-time.ts
//
// Shared, pure timezone helper for the self-upgrade timing gate. Extracted so
// BOTH the operating-hours-derived path (window.ts) and the explicit
// maintenance-window path (config.ts) evaluate day-of-week and wall-clock time
// against the STORE's timezone, not the portal container's host clock (which
// runs in UTC). Mixing the two is the defect that put the upgrade window in the
// middle of a US store's open day: a 9-5 schedule read in UTC "closes" at 17:00
// UTC = local noon.
//
// Pure + deterministic (inject `now`); no DB/auth, so the cron path can use it.

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Day-of-week (0=Sun) and "HH:mm" for `now` evaluated in `timeZone` (IANA).
 * Falls back to the host local zone if `timeZone` is missing/invalid — operating
 * hours and maintenance windows are only meaningful against the store's own clock.
 */
export function zonedDayAndTime(
  now: Date,
  timeZone?: string,
): { day: number; hhmm: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    const day = WEEKDAY_INDEX[wd] ?? now.getDay();
    return { day, hhmm: `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}` };
  } catch {
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return { day: now.getDay(), hhmm: `${hh}:${mm}` };
  }
}
