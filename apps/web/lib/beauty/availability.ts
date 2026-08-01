import { wallClockToUtc } from "@/lib/work-capture/recurrence-expander";
import type { BeautyAvailabilityFact } from "./capacity-facts";

export type BeautyAvailabilityRow = {
  availabilityId: string;
  resourceId: string;
  kind: string;
  days: number[];
  startTime: string | null;
  endTime: string | null;
  date: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  reason: string | null;
};

function localDateParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    year: Number(get("year")),
    monthIndex: Number(get("month")) - 1,
    day: Number(get("day")),
    weekday,
    key: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function parseTime(value: string | null): { hour: number; minute: number } | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

export function expandBeautyAvailability(input: {
  rows: BeautyAvailabilityRow[];
  windowStart: Date;
  windowEnd: Date;
  timeZone: string;
}): BeautyAvailabilityFact[] {
  const concrete: BeautyAvailabilityFact[] = [];
  const localDates = new Map<string, ReturnType<typeof localDateParts>>();
  for (
    let cursor = input.windowStart.getTime() - 86_400_000;
    cursor < input.windowEnd.getTime() + 86_400_000;
    cursor += 86_400_000
  ) {
    const local = localDateParts(new Date(cursor), input.timeZone);
    localDates.set(local.key, local);
  }

  for (const row of input.rows) {
    if (row.startsAt && row.endsAt) {
      if (row.startsAt < input.windowEnd && row.endsAt > input.windowStart) {
        concrete.push({
          availabilityId: row.availabilityId,
          resourceId: row.resourceId,
          kind: row.kind === "available" ? "available" : "unavailable",
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          reason: row.reason,
        });
      }
      continue;
    }
    const start = parseTime(row.startTime);
    const end = parseTime(row.endTime);
    if (!start || !end) continue;
    const datedKey = row.date?.toISOString().slice(0, 10);
    for (const local of localDates.values()) {
      if (datedKey ? local.key !== datedKey : !row.days.includes(local.weekday)) continue;
      const startsAt = wallClockToUtc(
        local.year,
        local.monthIndex,
        local.day,
        start.hour,
        start.minute,
        0,
        input.timeZone,
      );
      const endsAt = wallClockToUtc(
        local.year,
        local.monthIndex,
        local.day,
        end.hour,
        end.minute,
        0,
        input.timeZone,
      );
      if (startsAt < input.windowEnd && endsAt > input.windowStart && endsAt > startsAt) {
        concrete.push({
          availabilityId: `${row.availabilityId}:${local.key}`,
          resourceId: row.resourceId,
          kind: row.kind === "available" ? "available" : "unavailable",
          startsAt,
          endsAt,
          reason: row.reason,
        });
      }
    }
  }
  return concrete;
}

export function beautyResourceIsAvailable(input: {
  rows: BeautyAvailabilityRow[];
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
}): boolean {
  if (input.rows.length === 0) return true;
  const windows = expandBeautyAvailability({
    rows: input.rows,
    windowStart: input.startsAt,
    windowEnd: input.endsAt,
    timeZone: input.timeZone,
  });
  if (windows.some((window) =>
    window.kind === "unavailable" &&
    window.startsAt < input.endsAt &&
    window.endsAt > input.startsAt
  )) return false;
  const available = windows.filter((window) => window.kind === "available");
  const hasConfiguredAvailability = input.rows.some((row) => row.kind === "available");
  return !hasConfiguredAvailability || available.some((window) =>
    window.startsAt <= input.startsAt && window.endsAt >= input.endsAt
  );
}
