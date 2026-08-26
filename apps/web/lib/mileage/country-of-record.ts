// lib/mileage/country-of-record.ts — the employee's governing jurisdiction.
//
// Mileage policy is usually tied to the employee's country of record, not to
// wherever they happen to be driving, so pricing needs that country before it
// can pick a rate plan (DI-5E5AFE040A1F).
//
// There is no employeeProfile.countryCode column and this deliberately does not
// add one. Country of record already exists in canonical MDM reference data —
// EmployeeAddress -> Address -> City -> Region -> Country.iso2 — and a second
// copy on the profile would be a parallel store that drifts the first time
// someone moves. This module is the single read path onto it.

import { normaliseCountryCode } from "./rates";

/** The slice of Prisma this module needs, so tests need no live database. */
export type CountryOfRecordClient = {
  employeeAddress: {
    findMany: (args: unknown) => Promise<
      Array<{
        isPrimary: boolean;
        address: { city: { region: { country: { iso2: string } } } | null } | null;
      }>
    >;
  };
};

/**
 * ISO 3166-1 alpha-2 country of record for an employee, or null when unknown.
 *
 * Prefers the address flagged primary. An employee with several addresses and
 * none flagged primary has no country of record we can defend, so this returns
 * null rather than picking the first row — pricing then falls back to an
 * unscoped plan instead of paying someone against an arbitrary address.
 *
 * Null is a legitimate answer, not an error: an org with no addresses recorded
 * still prices trips, just on its unscoped plan.
 */
export async function employeeCountryOfRecord(
  db: CountryOfRecordClient,
  employeeProfileId: string,
): Promise<string | null> {
  const rows = await db.employeeAddress.findMany({
    where: { employeeProfileId },
    select: {
      isPrimary: true,
      address: { select: { city: { select: { region: { select: { country: { select: { iso2: true } } } } } } } },
    },
    // Primary first so the common case reads one row and stops caring about the rest.
    orderBy: [{ isPrimary: "desc" }],
  });

  const withCountry = rows.filter((row) => Boolean(row.address?.city?.region?.country?.iso2));
  if (withCountry.length === 0) return null;

  const primary = withCountry.filter((row) => row.isPrimary);
  // Exactly one primary is the answer. None, or several, is ambiguous.
  if (primary.length === 1) return normaliseCountryCode(primary[0].address!.city!.region.country.iso2);
  if (primary.length === 0 && withCountry.length === 1) {
    return normaliseCountryCode(withCountry[0].address!.city!.region.country.iso2);
  }
  return null;
}
