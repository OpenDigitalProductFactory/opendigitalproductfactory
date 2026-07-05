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

/** Tombstone statuses excluded from default list/typeahead reads. */
export const CUSTOMER_TOMBSTONE_STATUSES = ["superseded"] as const;

/**
 * Default-read where fragment: excludes merge tombstones. Spread into the
 * `where` of any CustomerAccount/CustomerSite list or typeahead query that
 * has no explicit status filter of its own.
 */
export const EXCLUDE_TOMBSTONED = {
  status: { notIn: [...CUSTOMER_TOMBSTONE_STATUSES] as string[] },
} as const;
