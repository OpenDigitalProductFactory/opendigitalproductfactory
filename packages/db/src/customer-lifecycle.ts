/**
 * Canonical lifecycle unions for customer master-data models (AGENTS.md §3).
 *
 * `superseded` is the merge tombstone: the row was merged into a survivor
 * (`mergedIntoId` set) and is excluded from default reads. `archived` is an
 * operator retirement with no survivor. Both are data-lifecycle states,
 * distinct from the business-relationship states (`closed`, `inactive`).
 *
 * Existing values keep their historical spelling (`at_risk` predates the
 * hyphenation convention and is preserved as stored data).
 */

export const CUSTOMER_ACCOUNT_STATUSES = [
  "prospect",
  "qualified",
  "onboarding",
  "active",
  "at_risk",
  "suspended",
  "closed",
  "superseded",
  "archived",
] as const;
export type CustomerAccountStatus = (typeof CUSTOMER_ACCOUNT_STATUSES)[number];

export const CUSTOMER_SITE_STATUSES = [
  "active",
  "planned",
  "inactive",
  "superseded",
  "archived",
] as const;
export type CustomerSiteStatus = (typeof CUSTOMER_SITE_STATUSES)[number];

/**
 * Statuses excluded from default list/typeahead reads: `superseded` (merged into
 * a survivor) and `archived` (operator-retired soft-delete, BI-15AC1B33). Both
 * remain resolvable by direct id — archiving hides an account from active lists
 * without destroying it or its history.
 */
export const CUSTOMER_TOMBSTONE_STATUSES = ["superseded", "archived"] as const;

/**
 * Default-read where fragment: excludes tombstoned + archived rows. Spread into
 * the `where` of any CustomerAccount/CustomerSite list or typeahead query that
 * has no explicit status filter of its own.
 */
export const EXCLUDE_TOMBSTONED = {
  status: { notIn: [...CUSTOMER_TOMBSTONE_STATUSES] as string[] },
} as const;
