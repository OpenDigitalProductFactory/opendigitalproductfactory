import "server-only";

import { prisma } from "@dpf/db";

import { coercePhoneCountry, DEFAULT_PHONE_COUNTRY, type CountryCode } from "./phone";

/**
 * Resolve the install's home country for phone formatting.
 *
 * Source of truth is the organization's tax profile `homeCountryCode` (set
 * during tax setup), falling back to the licensing profile, then to
 * {@link DEFAULT_PHONE_COUNTRY}. Single-tenant: there is one organization.
 * Surfaced to the UI via {@link ../components/ui/PhoneCountryContext} so
 * `PhoneInput` defaults to it without per-form plumbing.
 */
export async function resolveHomePhoneCountry(): Promise<CountryCode> {
  try {
    const [tax, license] = await Promise.all([
      prisma.organizationTaxProfile.findFirst({
        select: { homeCountryCode: true },
      }),
      prisma.organizationLicenseProfile.findFirst({
        select: { homeCountryCode: true },
      }),
    ]);
    return (
      coercePhoneCountry(tax?.homeCountryCode) ??
      coercePhoneCountry(license?.homeCountryCode) ??
      DEFAULT_PHONE_COUNTRY
    );
  } catch {
    return DEFAULT_PHONE_COUNTRY;
  }
}
