import type { Prisma } from "@dpf/db";

export type NativeCalendarCivilRange = { start: Date; end: Date };

/** A viewer's civil window accompanies, but never replaces, timed-event instants. */
export function readNativeCalendarCivilRange(
  start: string | null, end: string | null, rangeStart: Date, rangeEnd: Date,
): NativeCalendarCivilRange | null | undefined {
  if (start === null && end === null) return undefined;
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const civil = { start: new Date(`${start}T00:00:00Z`), end: new Date(`${end}T00:00:00Z`) };
  if (!Number.isFinite(civil.start.getTime()) || !Number.isFinite(civil.end.getTime())) return null;
  if (civil.start.toISOString().slice(0, 10) !== start || civil.end.toISOString().slice(0, 10) !== end) return null;
  if (civil.end <= civil.start || rangeEnd <= rangeStart) return null;
  const day = 86_400_000;
  if (Math.abs(+civil.start - +rangeStart) >= day || Math.abs(+civil.end - +rangeEnd) >= day) return null;
  return civil;
}

export function nativeCalendarRangeWhere(
  start: Date, end: Date, civil?: NativeCalendarCivilRange,
): Prisma.CalendarEventWhereInput {
  const instant: Prisma.CalendarEventWhereInput = {
    startAt: { lte: end },
    OR: [{ endAt: { gte: start } }, { endAt: null, startAt: { gte: start } }],
  };
  if (!civil) return instant;
  return { OR: [
    { allDay: true, syncSource: null, startAt: { lt: civil.end }, OR: [
      { endAt: { gt: civil.start } }, { endAt: null, startAt: { gte: civil.start } },
    ] },
    { AND: [{ OR: [{ allDay: false }, { syncSource: { not: null } }] }, instant] },
  ] };
}
