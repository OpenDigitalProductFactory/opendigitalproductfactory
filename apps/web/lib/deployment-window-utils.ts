// apps/web/lib/deployment-window-utils.ts
// Pure synchronous window evaluator — no "use server" so it can be imported
// by both server actions and non-action modules without triggering Next.js
// "Server Actions must be async" constraints.

/**
 * Returns true if `now` falls within any of the given time windows.
 * Day and time are evaluated using the server's local timezone (Date.getDay/getHours).
 * Overnight windows where startTime > endTime (e.g. "22:00"-"06:00") are supported.
 */
export function isInWindow(
  windows: Array<{ dayOfWeek: number[]; startTime: string; endTime: string }>,
  now?: Date,
): boolean {
  const d = now ?? new Date();
  const currentDay = d.getDay();
  const currentTime = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  return windows.some((w) => {
    if (!w.dayOfWeek.includes(currentDay)) return false;
    if (w.startTime <= w.endTime) {
      return currentTime >= w.startTime && currentTime < w.endTime;
    }
    // Overnight window: e.g. 22:00-06:00 → matches >= 22:00 OR < 06:00
    return currentTime >= w.startTime || currentTime < w.endTime;
  });
}
