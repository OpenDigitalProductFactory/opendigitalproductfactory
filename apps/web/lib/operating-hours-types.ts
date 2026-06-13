// Operating hours types and constants — shared by server actions and tests.
// Separated from the "use server" module to avoid server action export restrictions.

export type DaySchedule = {
  enabled: boolean;
  open: string;  // "HH:mm"
  close: string; // "HH:mm"
};

export type WeeklySchedule = {
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
};

export const GENERIC_DEFAULTS: WeeklySchedule = {
  monday:    { enabled: true, open: "09:00", close: "17:00" },
  tuesday:   { enabled: true, open: "09:00", close: "17:00" },
  wednesday: { enabled: true, open: "09:00", close: "17:00" },
  thursday:  { enabled: true, open: "09:00", close: "17:00" },
  friday:    { enabled: true, open: "09:00", close: "17:00" },
  saturday:  { enabled: false, open: "09:00", close: "17:00" },
  sunday:    { enabled: false, open: "09:00", close: "17:00" },
};

// Fallback used everywhere the org has not pinned an Operating Hours timezone.
export const DEFAULT_OPERATING_HOURS_TIMEZONE = "UTC";

/**
 * Single source of truth for the org's display timezone, derived from the
 * Operating Hours setting (BusinessProfile.timezone). Both the Operating Hours
 * settings page and the public booking calendar resolve through this so the two
 * can never diverge (AUDIT-R2-NS-B-005). The stale StorefrontConfig.timezone
 * 'Europe/London' schema default is never consulted — an unset profile timezone
 * resolves to UTC, exactly what the settings page shows on a fresh install.
 *
 * `suggestedTimezone` (e.g. inferred during URL import setup) is honoured only
 * while the profile still holds the UTC placeholder, mirroring getOperatingHours.
 */
export function resolveOperatingHoursTimezone(
  profileTimezone: string | null | undefined,
  suggestedTimezone?: string | null,
): string {
  const profileTz = profileTimezone?.trim();
  if (profileTz && profileTz !== DEFAULT_OPERATING_HOURS_TIMEZONE) return profileTz;
  return (
    suggestedTimezone?.trim() || profileTz || DEFAULT_OPERATING_HOURS_TIMEZONE
  );
}
