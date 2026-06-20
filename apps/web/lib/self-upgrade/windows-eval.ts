// apps/web/lib/self-upgrade/windows-eval.ts
//
// Pure, prisma-free evaluation primitives for a set of maintenance windows.
// Extracted so the three window paths share ONE day-of-week + overnight-span +
// store-timezone implementation instead of three copies:
//   - the explicit operator-configured override (config.ts / window.ts), and
//   - the auto-selected 24/7 overnight window (auto-window.ts).
// Kept free of any DB/auth import (the `MaintenanceWindow` type is imported
// type-only, so nothing here pulls in @dpf/db) so the unattended cron path and
// the pure unit tests can use it without a Prisma client.

import { zonedDayAndTime } from "./zoned-time";
import type { MaintenanceWindow } from "./config";

const WINDOW_SCAN_STEP_MS = 60_000; // 1-minute resolution — window times are HH:mm aligned
const WINDOW_SCAN_HORIZON_MS = 8 * 24 * 60 * 60 * 1000; // 8 days covers any weekly window set

/**
 * True when `now` falls within any of `windows`, evaluated against `timeZone`
 * (IANA) — the STORE's clock, not the portal container's UTC host clock (which
 * would fire a "02:00-04:00" window at the wrong real-world time). Handles
 * overnight spans (start > end, e.g. 22:00-06:00).
 */
export function isWithinWindows(
  windows: MaintenanceWindow[],
  now: Date,
  timeZone?: string,
): boolean {
  const { day: currentDay, hhmm: currentTime } = zonedDayAndTime(now, timeZone);
  return windows.some((w) => {
    if (!w.dayOfWeek.includes(currentDay)) return false;
    if (w.startTime <= w.endTime) {
      return currentTime >= w.startTime && currentTime < w.endTime;
    }
    return currentTime >= w.startTime || currentTime < w.endTime; // overnight
  });
}

/**
 * Next instant any of `windows` opens, evaluated in `timeZone`. Returns `now`
 * when a window is already active, null when none open within an 8-day horizon
 * or `windows` is empty. Minute-resolution forward scan that reuses
 * {@link isWithinWindows} so all timezone/overnight handling stays in one place.
 */
export function nextWindowStartForWindows(
  windows: MaintenanceWindow[],
  now: Date,
  timeZone?: string,
): Date | null {
  if (windows.length === 0) return null;
  if (isWithinWindows(windows, now, timeZone)) return now;

  // Align to the next whole minute so the boundary lands on the window's start
  // time (e.g. 02:00) rather than an arbitrary second within it.
  const start = Math.ceil(now.getTime() / WINDOW_SCAN_STEP_MS) * WINDOW_SCAN_STEP_MS;
  const limit = now.getTime() + WINDOW_SCAN_HORIZON_MS;
  for (let t = start; t <= limit; t += WINDOW_SCAN_STEP_MS) {
    const probe = new Date(t);
    if (isWithinWindows(windows, probe, timeZone)) return probe;
  }
  return null;
}
