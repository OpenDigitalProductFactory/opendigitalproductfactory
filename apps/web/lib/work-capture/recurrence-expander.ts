// Recurrence expander (work-capture primitive, BI-4C5F7A2D §9.4/§9.7).
//
// Expands a bounded RFC-5545 RRULE subset into concrete UTC occurrences within a
// window. Timezone/DST is the #1 recurrence bug class (external validation §1):
// occurrences must stay wall-clock-stable across DST boundaries (a 09:00 Monday
// cadence stays 09:00 local through spring-forward AND fall-back). We evaluate in
// the schedule's IANA timezone using built-in Intl (no deps — installable-in-CI
// libraries can't be added in this worktree, and rrule's own DST handling is its
// weakest area), then store UTC. Supported subset: FREQ DAILY|WEEKLY|MONTHLY,
// INTERVAL, BYDAY (weekly), COUNT | UNTIL. Anything else throws — bounded on
// purpose (§9.7). Pure: caller passes the window; no Date.now().

export type Weekday = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";
const WEEKDAY_INDEX: Record<Weekday, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export type ParsedRRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  byday: Weekday[]; // weekly only
  count: number | null;
  until: Date | null; // UTC instant bound
};

/** Parse the supported RRULE subset. Throws on unsupported parts (bounded by design). */
export function parseRRule(rrule: string): ParsedRRule {
  const parts = new Map<string, string>();
  for (const seg of rrule.trim().split(";")) {
    if (!seg) continue;
    const eq = seg.indexOf("=");
    if (eq < 0) throw new Error(`Malformed RRULE segment: ${JSON.stringify(seg)}`);
    parts.set(seg.slice(0, eq).toUpperCase(), seg.slice(eq + 1));
  }
  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY") {
    throw new Error(`Unsupported FREQ: ${JSON.stringify(freq)} (supported: DAILY, WEEKLY, MONTHLY).`);
  }
  const interval = parts.has("INTERVAL") ? Number.parseInt(parts.get("INTERVAL")!, 10) : 1;
  if (!Number.isFinite(interval) || interval < 1) throw new Error(`Invalid INTERVAL: ${parts.get("INTERVAL")}`);

  const byday: Weekday[] = [];
  if (parts.has("BYDAY")) {
    for (const d of parts.get("BYDAY")!.split(",")) {
      const up = d.trim().toUpperCase();
      if (!(up in WEEKDAY_INDEX)) throw new Error(`Unsupported BYDAY token: ${JSON.stringify(d)}`);
      byday.push(up as Weekday);
    }
  }
  const count = parts.has("COUNT") ? Number.parseInt(parts.get("COUNT")!, 10) : null;
  if (count !== null && (!Number.isFinite(count) || count < 1)) throw new Error(`Invalid COUNT: ${parts.get("COUNT")}`);

  let until: Date | null = null;
  if (parts.has("UNTIL")) {
    const raw = parts.get("UNTIL")!;
    // Accept RFC-5545 basic UTC form (YYYYMMDD[THHMMSSZ]) or an ISO string.
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(raw);
    until = m
      ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? "0"), +(m[5] ?? "0"), +(m[6] ?? "0")))
      : new Date(raw);
    if (Number.isNaN(until.getTime())) throw new Error(`Invalid UNTIL: ${JSON.stringify(raw)}`);
  }
  if (count !== null && until !== null) throw new Error("RRULE must not set both COUNT and UNTIL.");
  return { freq, interval, byday, count, until };
}

// ── Timezone-aware wall-clock ⇄ UTC (built-in Intl; DST-correct) ──────────────

/** ms to add to a UTC instant to get the same wall-clock in `tz` (the tz offset at that instant). */
function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const asIfUtc = Date.UTC(p.year!, p.month! - 1, p.day!, (p.hour! % 24), p.minute!, p.second!);
  return asIfUtc - utcMs;
}

/**
 * The UTC instant for a wall-clock date/time in `tz`. Two-pass correction makes it
 * DST-stable: the offset is recomputed at the corrected instant, so a fixed local
 * time-of-day maps to the right UTC instant on both sides of a DST transition.
 */
export function wallClockToUtc(
  y: number, monthIndex: number, day: number, hour: number, minute: number, second: number, tz: string,
): Date {
  const guess = Date.UTC(y, monthIndex, day, hour, minute, second);
  const off1 = tzOffsetMs(guess, tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(utc, tz);
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc);
}

/** The wall-clock fields of a UTC instant as seen in `tz`. */
function wallClockInTz(utc: Date, tz: string): { y: number; monthIndex: number; day: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(utc)) p[part.type] = part.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: Number(p.year), monthIndex: Number(p.month) - 1, day: Number(p.day), weekday: weekdayMap[p.weekday!]! };
}

export type Occurrence = { occurrenceAt: Date; instanceNumber: number };

/**
 * Expand `schedule` into UTC occurrences intersecting [windowStart, windowEnd).
 * Wall-clock time-of-day is taken from `anchorAt` (evaluated in `timezone`).
 * A hard `maxOccurrences` cap guards against an unbounded (no COUNT/UNTIL) rule —
 * the caller's materialization horizon, never the rule, bounds output (§9.3).
 */
export function expandOccurrences(input: {
  rrule: string;
  timezone: string;
  anchorAt: Date;
  until: Date | null; // schedule-level until (in addition to any RRULE UNTIL)
  windowStart: Date;
  windowEnd: Date;
  maxOccurrences: number;
}): Occurrence[] {
  const rule = parseRRule(input.rrule);
  const tz = input.timezone;
  const anchorLocal = wallClockInTz(input.anchorAt, tz);
  const timeOfDay = timeOfDayInTz(input.anchorAt, tz);
  const hardUntil = earliest(rule.until, input.until);

  const out: Occurrence[] = [];
  let produced = 0; // counts ALL rule occurrences from anchor (for COUNT + instanceNumber)
  const step = rule.interval;

  // Iterate candidate LOCAL dates from the anchor forward; convert each to UTC.
  // Cap total iterations to (window span in days) + a safety margin, scaled by
  // frequency, so an unbounded rule still terminates on the window.
  const maxIterDays = Math.ceil((input.windowEnd.getTime() - input.anchorAt.getTime()) / 86_400_000) + 366;
  let cursor = { y: anchorLocal.y, monthIndex: anchorLocal.monthIndex, day: anchorLocal.day };

  for (let i = 0; i <= maxIterDays; i++) {
    const emitDates: { y: number; monthIndex: number; day: number }[] = [];

    if (rule.freq === "DAILY") {
      if (i % step === 0) emitDates.push(cursor);
    } else if (rule.freq === "WEEKLY") {
      // BYDAY (or the anchor's weekday) within an eligible week (interval by week).
      const weeksSinceAnchor = Math.floor(daysBetween(anchorLocal, cursor) / 7);
      const targetDays = rule.byday.length ? rule.byday.map((d) => WEEKDAY_INDEX[d]) : [anchorLocal.weekday];
      const cursorWeekday = weekdayOf(cursor);
      if (weeksSinceAnchor % step === 0 && targetDays.includes(cursorWeekday)) emitDates.push(cursor);
    } else {
      // MONTHLY on the anchor's day-of-month, every `step` months.
      const monthsSinceAnchor =
        (cursor.y - anchorLocal.y) * 12 + (cursor.monthIndex - anchorLocal.monthIndex);
      if (monthsSinceAnchor % step === 0 && cursor.day === anchorLocal.day) emitDates.push(cursor);
    }

    for (const d of emitDates) {
      const occ = wallClockToUtc(d.y, d.monthIndex, d.day, timeOfDay.hour, timeOfDay.minute, timeOfDay.second, tz);
      if (occ.getTime() < input.anchorAt.getTime()) continue;
      if (hardUntil && occ.getTime() > hardUntil.getTime()) return out;
      produced += 1;
      if (rule.count !== null && produced > rule.count) return out;
      if (occ.getTime() >= input.windowStart.getTime() && occ.getTime() < input.windowEnd.getTime()) {
        out.push({ occurrenceAt: occ, instanceNumber: produced });
        if (out.length >= input.maxOccurrences) return out;
      }
    }

    // advance one local day
    cursor = addLocalDay(cursor);
    if (utcOfLocalMidnight(cursor, tz) > input.windowEnd.getTime()) break;
  }
  return out;
}

// ── date helpers (proleptic Gregorian on local wall-clock fields) ─────────────
function timeOfDayInTz(utc: Date, tz: string): { hour: number; minute: number; second: number } {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(utc)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { hour: (p.hour ?? 0) % 24, minute: p.minute ?? 0, second: p.second ?? 0 };
}
function addLocalDay(d: { y: number; monthIndex: number; day: number }) {
  const t = new Date(Date.UTC(d.y, d.monthIndex, d.day + 1));
  return { y: t.getUTCFullYear(), monthIndex: t.getUTCMonth(), day: t.getUTCDate() };
}
function weekdayOf(d: { y: number; monthIndex: number; day: number }): number {
  return new Date(Date.UTC(d.y, d.monthIndex, d.day)).getUTCDay();
}
function daysBetween(a: { y: number; monthIndex: number; day: number }, b: { y: number; monthIndex: number; day: number }): number {
  return Math.round((Date.UTC(b.y, b.monthIndex, b.day) - Date.UTC(a.y, a.monthIndex, a.day)) / 86_400_000);
}
function utcOfLocalMidnight(d: { y: number; monthIndex: number; day: number }, _tz: string): number {
  return Date.UTC(d.y, d.monthIndex, d.day);
}
function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}
