// apps/web/lib/self-upgrade/auto-window.ts
//
// 24/7 self-upgrade window selection (BI-A6382FB9). The upgrade window is
// normally derived as "any time the store is CLOSED" (window.ts). A 24/7 store
// has no closed hours, so that model never opens a window and scheduled
// upgrades never run. This module fills that gap: when a store is effectively
// 24/7, it auto-selects a low-traffic OVERNIGHT window in the store's timezone
// (an observed trough from BusinessProfile.lowTrafficWindows when a valid one
// exists, else a default ~02:00-04:00 local), and only asks the operator when
// there is a genuine need (no timezone known / derivable).
//
// Pure + prisma-free (inject `now`), so the unattended cron path and the unit
// tests can use it without a DB/auth round-trip. Explicit operator-configured
// maintenance windows take priority over this resolution and are handled by the
// caller; this module only decides the auto / operating-hours / ask split.

import type { WeeklySchedule } from "@/lib/operating-hours-types";
import type { MaintenanceWindow } from "./config";
import { nextWindowStartForWindows } from "./windows-eval";
import { nextUpgradeWindowOpen } from "./window";

/**
 * Default low-traffic overnight window used when no valid observed trough is
 * available: 02:00-04:00 local, every day. Two whole hours give the hourly cron
 * (`0 * * * *`) the 02:00 and 03:00 ticks to start an upgrade.
 */
export const DEFAULT_OVERNIGHT_WINDOW: MaintenanceWindow = {
  dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
  startTime: "02:00",
  endTime: "04:00",
};

/** A schedule-derived or telemetry-observed low-traffic slot (BusinessProfile.lowTrafficWindows). */
export type LowTrafficWindow = {
  dayOfWeek: number;
  start: string;
  end: string;
};

// An upgrade window should be a quiet slot, not "all day"; reject anything longer.
const MAX_TROUGH_MINUTES = 6 * 60;

export type AutoUpgradeWindowResult =
  | { kind: "operating-hours" }
  | { kind: "auto-overnight"; windows: MaintenanceWindow[]; source: "trough" | "default" }
  | { kind: "needs-timezone" };

/**
 * True when the store never closes within the 8-day scan horizon, i.e. the
 * operating-hours model produces no window — exactly when nextUpgradeWindowOpen
 * returns null. A store with even a short real closed window is NOT 24/7 and
 * keeps the operating-hours model.
 */
export function isEffectively247(
  schedule: WeeklySchedule,
  now: Date,
  timeZone?: string,
): boolean {
  return nextUpgradeWindowOpen(schedule, now, timeZone) === null;
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Window length in minutes, handling an overnight wrap (end <= start). null when malformed. */
function windowDurationMinutes(start: string, end: string): number | null {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null) return null;
  if (s === e) return 0;
  return e > s ? e - s : 24 * 60 - s + e;
}

/**
 * Pick usable overnight maintenance windows from observed/derived low-traffic
 * slots. Accepts only well-formed, non-degenerate, quiet slots (<= 6h) and
 * groups identical ranges across days into MaintenanceWindow[]. Returns null
 * when none qualify -- which is the case for a 24/7 schedule, whose derived
 * lowTrafficWindows are the malformed "24:00"-"23:59" artifacts
 * deriveLowTrafficWindows emits -- so the caller falls back to the default.
 */
export function selectTroughWindows(
  lowTrafficWindows: LowTrafficWindow[],
): MaintenanceWindow[] | null {
  const byRange = new Map<string, { startTime: string; endTime: string; days: number[] }>();
  for (const w of lowTrafficWindows) {
    if (!w || typeof w.dayOfWeek !== "number" || w.dayOfWeek < 0 || w.dayOfWeek > 6) continue;
    const dur = windowDurationMinutes(w.start, w.end);
    if (dur === null || dur <= 0 || dur > MAX_TROUGH_MINUTES) continue;
    const key = `${w.start}|${w.end}`;
    const entry = byRange.get(key) ?? { startTime: w.start, endTime: w.end, days: [] };
    if (!entry.days.includes(w.dayOfWeek)) entry.days.push(w.dayOfWeek);
    byRange.set(key, entry);
  }
  if (byRange.size === 0) return null;
  return Array.from(byRange.values()).map((entry) => ({
    dayOfWeek: entry.days.sort((a, b) => a - b),
    startTime: entry.startTime,
    endTime: entry.endTime,
  }));
}

/**
 * Resolve how the self-upgrade window should be derived for a store:
 *  - not effectively-24/7 -> "operating-hours" (the existing store-closed model).
 *  - 24/7 + known timezone -> "auto-overnight": a low-traffic overnight window in
 *    the store tz (observed trough if a valid one exists, else ~02:00-04:00).
 *  - 24/7 + no known timezone -> "needs-timezone": an overnight window in an
 *    unknown zone could land at peak, so the caller prompts the operator instead
 *    of guessing.
 * Explicit operator-configured windows are handled by the caller and take
 * priority over this resolution.
 */
export function resolveAutoUpgradeWindow(args: {
  schedule: WeeklySchedule;
  timeZone: string;
  timezoneKnown: boolean;
  lowTrafficWindows?: LowTrafficWindow[];
  now?: Date;
}): AutoUpgradeWindowResult {
  const now = args.now ?? new Date();
  if (!isEffectively247(args.schedule, now, args.timeZone)) {
    return { kind: "operating-hours" };
  }
  if (!args.timezoneKnown) {
    return { kind: "needs-timezone" };
  }
  const trough = selectTroughWindows(args.lowTrafficWindows ?? []);
  if (trough && trough.length > 0) {
    return { kind: "auto-overnight", windows: trough, source: "trough" };
  }
  return { kind: "auto-overnight", windows: [DEFAULT_OVERNIGHT_WINDOW], source: "default" };
}

/** Next instant one of the auto-selected windows opens (store tz). */
export function nextAutoWindowOpen(
  windows: MaintenanceWindow[],
  now: Date,
  timeZone?: string,
): Date | null {
  return nextWindowStartForWindows(windows, now, timeZone);
}

/** "02:00" -> "2:00 AM". For the read-only schedule summary in the Upgrade Center. */
export function formatWindowClock(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  let h = Number(m[1] ?? "0");
  const min = m[2] ?? "00";
  const meridiem = h < 12 ? "AM" : "PM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${meridiem}`;
}

/** Distinct window ranges as a friendly string, e.g. "2:00 AM-4:00 AM". */
export function describeWindows(windows: MaintenanceWindow[]): string {
  const ranges = Array.from(
    new Set(
      windows.map(
        (w) => `${formatWindowClock(w.startTime)}–${formatWindowClock(w.endTime)}`,
      ),
    ),
  );
  return ranges.join(", ");
}
