// apps/web/lib/self-upgrade/window.ts
//
// Self-upgrade timing gate. Per operator intent, the upgrade window is "any time
// the storefront is NOT open" — derived from the operating hours the operator
// already configures, so there is no separate window to set and no "no window
// configured → never runs" dead-end. Explicit maintenance windows remain an
// advanced override for installs that want a bespoke schedule.
//
// Pure + deterministic (inject `now`); no DB/auth, so the cron path can use it.

import type { WeeklySchedule } from "@/lib/operating-hours-types";
import type { MaintenanceWindow } from "./config";

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

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
 * hours are only meaningful against the store's own clock.
 */
export function zonedDayAndTime(now: Date, timeZone?: string): { day: number; hhmm: string } {
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

/**
 * True when the storefront is open at `now` per its weekly schedule. A day with
 * `enabled: false` is closed all day. Handles overnight spans (open > close,
 * e.g. 18:00–02:00) by matching either side of midnight.
 */
export function isStoreOpen(schedule: WeeklySchedule, now: Date, timeZone?: string): boolean {
  const { day, hhmm } = zonedDayAndTime(now, timeZone);
  const d = schedule[DAY_KEYS[day]];
  if (!d || !d.enabled) return false;
  if (d.open === d.close) return false; // zero-length = treated as closed
  if (d.open < d.close) return hhmm >= d.open && hhmm < d.close;
  return hhmm >= d.open || hhmm < d.close; // overnight
}

function isInExplicitWindows(windows: MaintenanceWindow[], now: Date): boolean {
  const day = now.getDay();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return windows.some((w) => {
    if (!w.dayOfWeek.includes(day)) return false;
    if (w.startTime <= w.endTime) return hhmm >= w.startTime && hhmm < w.endTime;
    return hhmm >= w.startTime || hhmm < w.endTime; // overnight
  });
}

/**
 * Is an upgrade allowed to run right now?
 * - Explicit maintenance windows configured → honor them (advanced override).
 * - Otherwise → allowed whenever the store is CLOSED (the operator's model).
 * - No schedule and no windows → allowed (never silently block forever; the
 *   "enabled but no window → never runs" defect is what this replaces).
 */
export function isUpgradeWindowOpen(args: {
  explicitWindows?: MaintenanceWindow[];
  schedule?: WeeklySchedule | null;
  timeZone?: string;
  now?: Date;
}): boolean {
  const now = args.now ?? new Date();
  if (args.explicitWindows && args.explicitWindows.length > 0) {
    return isInExplicitWindows(args.explicitWindows, now);
  }
  if (args.schedule) {
    return !isStoreOpen(args.schedule, now, args.timeZone);
  }
  return true;
}

const SCAN_STEP_MS = 60_000; // 1-minute resolution — close times are HH:mm aligned
const SCAN_HORIZON_MS = 8 * 24 * 60 * 60 * 1000; // 8 days covers any weekly schedule

/**
 * The next instant the operating-hours upgrade window OPENS — i.e. the next time
 * the store is closed. Returns `now` when the store is already closed (the
 * window is open right now). Returns null when the store never closes within an
 * 8-day horizon (e.g. 24/7 hours), meaning there is no scheduled window to show.
 *
 * Minute-resolution forward scan that reuses isStoreOpen so all timezone and
 * overnight-span handling stays in one place. Pure + deterministic (inject
 * `now`) to match the rest of this module and stay cron-safe.
 */
export function nextUpgradeWindowOpen(
  schedule: WeeklySchedule,
  now: Date,
  timeZone?: string,
): Date | null {
  if (!isStoreOpen(schedule, now, timeZone)) return now;
  // Align to the next whole minute so the boundary lands on the schedule's
  // close time (e.g. 17:00) rather than an arbitrary second within it.
  const start = Math.ceil(now.getTime() / SCAN_STEP_MS) * SCAN_STEP_MS;
  const limit = now.getTime() + SCAN_HORIZON_MS;
  for (let t = start; t <= limit; t += SCAN_STEP_MS) {
    const probe = new Date(t);
    if (!isStoreOpen(schedule, probe, timeZone)) return probe;
  }
  return null;
}
