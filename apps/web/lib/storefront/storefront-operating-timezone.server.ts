import { resolveOperatingHoursTimezone } from "@/lib/operating-hours-types";

interface StorefrontOperatingTimezoneDatabase {
  businessProfile: {
    findFirst(args: unknown): Promise<{ timezone: string } | null>;
  };
}

/**
 * Canonical storefront and hospitality clock.
 *
 * Operating Hours owns the business timezone. StorefrontConfig.timezone is a
 * legacy default and must not independently drive calendars, confirmations,
 * owner handoffs, or capacity enforcement.
 */
export async function loadStorefrontOperatingTimezone(
  database: StorefrontOperatingTimezoneDatabase,
): Promise<string> {
  const profile = await database.businessProfile.findFirst({
    where: { isActive: true },
    select: { timezone: true },
  });
  return resolveOperatingHoursTimezone(profile?.timezone);
}
