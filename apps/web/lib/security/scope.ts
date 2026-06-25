// EP-SOVEREIGN-SOC P0 — denormalized scope key for SecurityEvent rows.
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §6.1.
//
// Mirrors InventoryEntity.scopeKey: "organization:internal" for the operator's
// own estate, "customer:<accountId>" for an MSP customer overlay. The site id
// is stored in its own column; the scopeKey keys on the customer account (the
// tenancy unit for fleet rollups and federation projection), so a missing
// account always resolves to the operator's own internal scope.

export const ORG_INTERNAL_SCOPE_KEY = "organization:internal";

/**
 * Derive the SecurityEvent scopeKey. For edge-sourced events the inputs come
 * from the authenticated EdgeNode row (never the request body); for internal
 * sources they come from the actor/object context at write time.
 *
 * `customerSiteId` is intentionally not part of the key — it is persisted in
 * its own column and a site always belongs to an account, so the account is the
 * stable tenancy boundary.
 */
export function deriveSecurityScopeKey(
  customerAccountId: string | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  customerSiteId?: string | null,
): string {
  return customerAccountId
    ? `customer:${customerAccountId}`
    : ORG_INTERNAL_SCOPE_KEY;
}
