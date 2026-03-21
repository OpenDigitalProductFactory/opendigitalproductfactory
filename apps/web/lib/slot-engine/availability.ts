import type { AvailabilityRow, TimeWindow } from "./types";

function timeToMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

function isSameDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function buildAvailabilityWindows(
  rows: AvailabilityRow[],
  targetDate: Date
): TimeWindow[] {
  const overrides = rows.filter((r) => r.date !== null && isSameDate(r.date, targetDate));

  if (overrides.length > 0) {
    if (overrides.some((r) => r.isBlocked)) return [];
    return overrides
      .filter((r) => !r.isBlocked)
      .map((r) => ({
        startMinutes: timeToMinutes(r.startTime),
        endMinutes: timeToMinutes(r.endTime),
      }));
  }

  const dayOfWeek = targetDate.getUTCDay();
  return rows
    .filter((r) => r.date === null && r.days.includes(dayOfWeek))
    .map((r) => ({
      startMinutes: timeToMinutes(r.startTime),
      endMinutes: timeToMinutes(r.endTime),
    }));
}
