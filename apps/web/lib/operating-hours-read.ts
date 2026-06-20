// apps/web/lib/operating-hours-read.ts
//
// System-level (no-auth) reader for the storefront operating hours. Lives in a
// plain module — NOT a "use server" file — so non-request contexts like the
// self-upgrade cron can read the schedule without a user session and without
// exposing a new server-action endpoint. The "use server" operating-hours
// actions import the same helper, keeping one source of truth for the
// BusinessProfile.businessHours → WeeklySchedule mapping.

import { prisma } from "@dpf/db";
import { DEFAULT_OPERATING_HOURS_TIMEZONE, GENERIC_DEFAULTS } from "@/lib/operating-hours-types";
import type { DaySchedule, WeeklySchedule } from "@/lib/operating-hours-types";
import { resolveTimezoneFromLocation } from "@/lib/timezone-from-location";

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const CLOSED_DAY: DaySchedule = { enabled: false, open: "09:00", close: "17:00" };

/**
 * Best-effort IANA timezone derived from the captured business location, used
 * when the operator hasn't pinned a timezone on the active BusinessProfile (the
 * UTC placeholder). Prefers the precise US state code; falls back to a country
 * code found in the operating jurisdictions. Returns null when nothing resolves.
 * The platform captures these at setup, so the self-upgrade window should follow
 * them rather than silently evaluating in UTC (BI-0C000AB3).
 */
export async function deriveTimezoneFromBusinessLocation(): Promise<string | null> {
  // Fail-open: a best-effort default must never throw into the caller (the cron
  // window check or the settings page), and it keeps callers that mock only
  // businessProfile working.
  try {
    const ctx = await prisma.businessContext.findFirst({
      select: { stateCode: true, operatesIn: true },
    });
    if (!ctx) return null;
    const countryCode = (ctx.operatesIn ?? []).find((c) => /^[A-Za-z]{2}$/.test(c)) ?? null;
    return resolveTimezoneFromLocation({ stateCode: ctx.stateCode, countryCode });
  } catch {
    return null;
  }
}

/** Map the BusinessProfile.businessHours JSON to a full WeeklySchedule. */
export function profileHoursToSchedule(
  businessHours: Record<string, { open: string; close: string } | null>,
): WeeklySchedule {
  const schedule = { ...GENERIC_DEFAULTS };
  for (const day of DAY_NAMES) {
    const hours = businessHours[day];
    schedule[day] = hours ? { enabled: true, open: hours.open, close: hours.close } : { ...CLOSED_DAY };
  }
  return schedule;
}

/**
 * Resolve the active storefront's weekly schedule + timezone for system callers.
 * Mirrors getOperatingHours' confirmed-hours and generic-default priorities, but
 * without the auth guard or the setup-only archetype/URL suggestions (irrelevant
 * to an unattended upgrade decision). Returns the generic 9–5 weekday default
 * when no confirmed hours exist, so the upgrade window is always well-defined.
 */
export async function resolveOperatingScheduleForSystem(): Promise<{
  schedule: WeeklySchedule;
  timezone: string;
}> {
  const profile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    select: { businessHours: true, timezone: true, hoursConfirmedAt: true },
  });
  // Prefer the operator-pinned profile timezone; when it's unset or still the UTC
  // placeholder, derive from the captured business location so the upgrade window
  // is correct from day one rather than evaluating in UTC.
  let timezone =
    profile?.timezone && profile.timezone.length > 0
      ? profile.timezone
      : DEFAULT_OPERATING_HOURS_TIMEZONE;
  if (timezone === DEFAULT_OPERATING_HOURS_TIMEZONE) {
    const derived = await deriveTimezoneFromBusinessLocation();
    if (derived) timezone = derived;
  }
  if (profile?.hoursConfirmedAt && profile.businessHours) {
    const businessHours = profile.businessHours as Record<string, { open: string; close: string } | null>;
    return { schedule: profileHoursToSchedule(businessHours), timezone };
  }
  return { schedule: { ...GENERIC_DEFAULTS }, timezone };
}
