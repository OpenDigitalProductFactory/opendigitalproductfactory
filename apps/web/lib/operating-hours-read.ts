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
import { resolveTimezoneFromAddress, resolveTimezoneFromLocation } from "@/lib/timezone-from-location";
import { parseOrgAddress } from "@/lib/shared/org-address";
import type { LowTrafficWindow } from "@/lib/self-upgrade/auto-window";

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const CLOSED_DAY: DaySchedule = { enabled: false, open: "09:00", close: "17:00" };

/**
 * Best-effort IANA timezone derived from the captured business location, used
 * when the operator hasn't pinned a timezone on the active BusinessProfile (the
 * UTC placeholder). Prefers the precise US state code; falls back to a country
 * code found in the operating jurisdictions. Returns null when nothing resolves.
 * The platform captures these at setup, so the self-upgrade window should follow
 * them rather than silently evaluating in UTC (BI-0C000AB3 / BI-AAAA0691).
 */
export async function deriveTimezoneFromBusinessLocation(): Promise<string | null> {
  // Fail-open: a best-effort default must never throw into the caller (the cron
  // window check or the settings page), and it keeps callers that mock only
  // businessProfile working.
  try {
    // Precise source: the canonical Organization.address captured at setup. A US
    // address carries a state code, so it resolves to the correct one of the six
    // US zones rather than the country-only Eastern default (BI-AAAA0691).
    const org = await prisma.organization.findFirst({ select: { address: true } });
    const fromAddress = org ? resolveTimezoneFromAddress(parseOrgAddress(org.address)) : null;
    if (fromAddress) return fromAddress;

    // Fallback (no regression): BusinessContext.stateCode + the operating
    // jurisdiction country code, for installs that have those but no captured
    // address yet.
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

/** Defensive parse of the BusinessProfile.lowTrafficWindows JSON column. */
function parseLowTrafficWindows(raw: unknown): LowTrafficWindow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (w): w is LowTrafficWindow =>
      !!w &&
      typeof w === "object" &&
      typeof (w as { dayOfWeek?: unknown }).dayOfWeek === "number" &&
      typeof (w as { start?: unknown }).start === "string" &&
      typeof (w as { end?: unknown }).end === "string",
  );
}

/**
 * Resolve the active storefront's weekly schedule + timezone for system callers.
 * Mirrors getOperatingHours' confirmed-hours and generic-default priorities, but
 * without the auth guard or the setup-only archetype/URL suggestions (irrelevant
 * to an unattended upgrade decision). Returns the generic 9–5 weekday default
 * when no confirmed hours exist, so the upgrade window is always well-defined.
 *
 * Also surfaces the inputs the 24/7 auto-window decision needs (BI-A6382FB9):
 * - `timezoneKnown`: true when the timezone is a real, location-grounded/pinned
 *   zone, false when it fell back to the UTC placeholder (so a 24/7 store with no
 *   known zone is prompted rather than scheduled at a guessed local hour).
 * - `lowTrafficWindows`: the observed/derived troughs, preferred over the default
 *   overnight window when a valid one exists.
 */
export async function resolveOperatingScheduleForSystem(): Promise<{
  schedule: WeeklySchedule;
  timezone: string;
  timezoneKnown: boolean;
  lowTrafficWindows: LowTrafficWindow[];
}> {
  const profile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    select: {
      businessHours: true,
      timezone: true,
      hoursConfirmedAt: true,
      lowTrafficWindows: true,
    },
  });
  // Prefer the operator-pinned profile timezone; when it's unset or still the UTC
  // placeholder, derive from the captured business location so the upgrade window
  // is correct from day one rather than evaluating in UTC. resolveTimezoneFromLocation
  // never yields "UTC" and a pinned "UTC" is treated as the placeholder, so
  // "timezone !== placeholder" is a sound "we actually know the store's clock" signal.
  let timezone =
    profile?.timezone && profile.timezone.length > 0
      ? profile.timezone
      : DEFAULT_OPERATING_HOURS_TIMEZONE;
  let timezoneKnown = timezone !== DEFAULT_OPERATING_HOURS_TIMEZONE;
  if (!timezoneKnown) {
    const derived = await deriveTimezoneFromBusinessLocation();
    if (derived) {
      timezone = derived;
      timezoneKnown = true;
    }
  }
  const lowTrafficWindows = parseLowTrafficWindows(profile?.lowTrafficWindows);
  if (profile?.hoursConfirmedAt && profile.businessHours) {
    const businessHours = profile.businessHours as Record<string, { open: string; close: string } | null>;
    return {
      schedule: profileHoursToSchedule(businessHours),
      timezone,
      timezoneKnown,
      lowTrafficWindows,
    };
  }
  return { schedule: { ...GENERIC_DEFAULTS }, timezone, timezoneKnown, lowTrafficWindows };
}
