/**
 * EP-WORK-POSTURE Slice A (BI-462F3AF7) — the business clock as a posture input.
 *
 * Design: docs/superpowers/specs/2026-08-22-workroom-work-posture-design.md §6.
 *
 * A pure, deterministic function: given `now`, the org's weekly schedule and
 * timezone, its declared low-traffic windows, and an optional obligation
 * deadline, resolve exactly ONE temporal band. No I/O, no ambient `Date`, no
 * random — inputs in, band out, snapshot-testable. Same discipline as the
 * Golden Triangle compiler.
 *
 * FUSE, DO NOT BUILD. The weekly schedule, timezone and low-traffic windows all
 * come from the EXISTING operating-hours substrate (`lib/operating-hours-*`,
 * backed by BusinessProfile), which already drives the self-upgrade window and
 * deployment windows. This module introduces no second calendar and no second
 * timezone-resolution path.
 *
 * The band is an INPUT to posture, never a decision by itself: what a band does
 * to proactivity and priority is decided by the resolver in `resolve.ts`, under
 * the tighten-only invariant. In particular `out-of-hours` damps CADENCE AND
 * CHANNEL ONLY and never authority.
 */
import type { DaySchedule, WeeklySchedule } from "@/lib/operating-hours-types";
import type { LowTrafficWindow } from "@/lib/self-upgrade/auto-window";

export const TEMPORAL_BANDS = [
  "in-hours",
  "out-of-hours",
  "low-traffic",
  "pre-deadline",
  "breach-imminent",
] as const;
export type TemporalBand = (typeof TEMPORAL_BANDS)[number];

/**
 * Activity families whose harm ACCRUES while the business is closed. They are
 * exempt from out-of-hours damping entirely: a silently damped security
 * incident is the failure mode this design most needs to avoid (design §6).
 *
 * Deliberately a small, explicit list rather than a predicate — adding to it
 * should be a reviewed decision, not an emergent property of some heuristic.
 */
export const DAMPING_EXEMPT_ACTIVITY_FAMILIES = [
  "security-incident",
  "platform-health",
  "queue-health",
] as const;

const DAY_KEYS: ReadonlyArray<keyof WeeklySchedule> = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** Default warning window before an obligation's due time (24h), in minutes. */
export const DEFAULT_DEADLINE_WARNING_MINUTES = 24 * 60;

export interface TemporalBandInput {
  /** The instant being judged. Passed in — never read from the ambient clock. */
  now: Date;
  /** The org's weekly operating schedule, from the operating-hours substrate. */
  schedule?: WeeklySchedule | null;
  /** IANA zone the schedule is expressed in (resolveOperatingHoursTimezone output). */
  timezone?: string | null;
  /** Declared low-traffic troughs, from BusinessProfile.lowTrafficWindows. */
  lowTrafficWindows?: readonly LowTrafficWindow[] | null;
  /** When the obligation this work discharges is due, if any. */
  dueAt?: Date | null;
  /** How far ahead of `dueAt` the pre-deadline band opens. */
  deadlineWarningMinutes?: number;
  /**
   * The activity family, when known. Only consulted to apply the damping
   * exemption — an exempt family never resolves `out-of-hours`.
   */
  activityFamily?: string | null;
}

export interface TemporalBandResult {
  band: TemporalBand;
  /**
   * True when `now` falls inside a declared low-traffic trough. Reported
   * SEPARATELY from `band` on purpose: closed-ness and cheapness are different
   * questions, and an install whose troughs are the complement of its business
   * hours (the common case — the derived troughs literally are the closed
   * hours) would otherwise have every out-of-hours instant masked as
   * low-traffic, so "the business is closed" would never damp immediacy.
   * Found against live data 2026-08-22.
   */
  lowTraffic: boolean;
  /** True when the family's exemption suppressed an out-of-hours result. */
  dampingExempt: boolean;
  /** Stable machine-readable code, for posture adjustment provenance. */
  reasonCode: string;
  /** Operator-readable reason, for the provenance surface. */
  reason: string;
}

/** Minutes since local midnight for an "HH:mm" string, or null if malformed. */
function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Wall-clock day-of-week and minute-of-day for `now` in `timezone`.
 *
 * Uses Intl rather than arithmetic on the epoch so DST transitions are handled
 * by the platform's tz database rather than by us. Falls back to the host zone
 * when the timezone is absent or not recognised — fail-open, never throw.
 */
function localWallClock(now: Date, timezone: string | null | undefined): {
  dayOfWeek: number;
  minuteOfDay: number;
} {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timezone ? { timeZone: timezone } : {}),
  };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", options).formatToParts(now);
  } catch {
    // Unknown IANA zone — fall back to the host zone rather than failing.
    parts = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
  }
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  const weekdayIndex: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = weekdayIndex[lookup("weekday")] ?? now.getUTCDay();
  // Intl renders midnight as "24" in some ICU versions under hour12:false.
  const hour = Number(lookup("hour")) % 24;
  const minute = Number(lookup("minute"));
  const minuteOfDay =
    Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
  return { dayOfWeek, minuteOfDay };
}

/**
 * Is `minuteOfDay` inside [open, close)? A window whose close is at or before
 * its open is treated as crossing midnight (e.g. 22:00–02:00).
 */
function withinWindow(minuteOfDay: number, open: number, close: number): boolean {
  return close > open
    ? minuteOfDay >= open && minuteOfDay < close
    : minuteOfDay >= open || minuteOfDay < close;
}

function isOpenNow(day: DaySchedule | undefined, minuteOfDay: number): boolean {
  if (!day || !day.enabled) return false;
  const open = parseClock(day.open);
  const close = parseClock(day.close);
  if (open === null || close === null) return false;
  return withinWindow(minuteOfDay, open, close);
}

function inLowTrafficWindow(
  windows: readonly LowTrafficWindow[],
  dayOfWeek: number,
  minuteOfDay: number,
): boolean {
  for (const window of windows) {
    if (!window || window.dayOfWeek !== dayOfWeek) continue;
    const start = parseClock(window.start);
    const end = parseClock(window.end);
    if (start === null || end === null) continue;
    if (withinWindow(minuteOfDay, start, end)) return true;
  }
  return false;
}

export function isDampingExempt(activityFamily: string | null | undefined): boolean {
  if (!activityFamily) return false;
  return (DAMPING_EXEMPT_ACTIVITY_FAMILIES as readonly string[]).includes(activityFamily);
}

/**
 * Resolve the temporal band for an instant.
 *
 * Precedence, highest first — deadline pressure outranks the operating clock,
 * because an obligation does not stop being due because the office is shut:
 *
 *   breach-imminent  at or past the due boundary
 *   pre-deadline     inside the obligation's warning window
 *   out-of-hours     business closed (suppressed for exempt families)
 *   low-traffic      inside a declared trough AND open
 *   in-hours         everything else, including "we don't know"
 *
 * Fail-open: a missing, malformed or unparseable schedule resolves `in-hours`,
 * which is today's behaviour. This never throws.
 */
export function resolveTemporalBand(input: TemporalBandInput): TemporalBandResult {
  const exempt = isDampingExempt(input.activityFamily);
  let lowTraffic = false;

  try {
    const { dueAt, now } = input;
    if (dueAt instanceof Date && !Number.isNaN(dueAt.getTime())) {
      const minutesUntilDue = (dueAt.getTime() - now.getTime()) / 60_000;
      if (minutesUntilDue <= 0) {
        return {
          band: "breach-imminent",
          lowTraffic,
          dampingExempt: exempt,
          reasonCode: "deadline_breached",
          reason: "The obligation is at or past its due time.",
        };
      }
      const warning = input.deadlineWarningMinutes ?? DEFAULT_DEADLINE_WARNING_MINUTES;
      if (minutesUntilDue <= warning) {
        return {
          band: "pre-deadline",
          lowTraffic,
          dampingExempt: exempt,
          reasonCode: "deadline_near",
          reason: "The obligation falls due inside the warning window.",
        };
      }
    }

    const { dayOfWeek, minuteOfDay } = localWallClock(now, input.timezone);

    const troughs = input.lowTrafficWindows ?? [];
    lowTraffic = troughs.length > 0 && inLowTrafficWindow(troughs, dayOfWeek, minuteOfDay);

    const schedule = input.schedule;
    if (!schedule) {
      return {
        band: "in-hours",
        lowTraffic,
        dampingExempt: exempt,
        reasonCode: "no_schedule",
        reason: "No operating schedule is configured, so no timing adjustment applies.",
      };
    }

    const dayKey = DAY_KEYS[dayOfWeek];
    if (isOpenNow(dayKey ? schedule[dayKey] : undefined, minuteOfDay)) {
      // Open, but inside a declared trough: cheap without being closed.
      return lowTraffic
        ? {
            band: "low-traffic",
            lowTraffic,
            dampingExempt: exempt,
            reasonCode: "low_traffic_window",
            reason: "Open, but inside a declared low-traffic window.",
          }
        : {
            band: "in-hours",
            lowTraffic,
            dampingExempt: exempt,
            reasonCode: "within_operating_hours",
            reason: "The business is open.",
          };
    }

    if (exempt) {
      // The business is closed, but harm accrues regardless — do not damp.
      return {
        band: "in-hours",
        lowTraffic,
        dampingExempt: true,
        reasonCode: "damping_exempt",
        reason:
          "The business is closed, but this kind of work worsens while unattended, so its timing is not damped.",
      };
    }

    // Closed outranks cheap. `lowTraffic` still rides along, so a caller can
    // take the cost opportunity without losing the immediacy answer.
    return {
      band: "out-of-hours",
      lowTraffic,
      dampingExempt: false,
      reasonCode: "outside_operating_hours",
      reason: "The business is closed.",
    };
  } catch {
    // Fail-open: a clock helper must never throw into a posture resolution.
    return {
      band: "in-hours",
      lowTraffic,
      dampingExempt: exempt,
      reasonCode: "temporal_resolution_failed",
      reason: "The business clock could not be read, so no timing adjustment applies.",
    };
  }
}
