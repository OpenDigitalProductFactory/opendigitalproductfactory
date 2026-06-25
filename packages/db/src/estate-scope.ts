// EP-MSP-FEDERATION · WS-0 convergence seam (BI-B59A09C3).
//
// The single estate-scope resolver every managed-services read model routes
// through. It composes the discovery scope-key grammar (discovery-scope.ts,
// MSP segmentation spec §8.1) so quality issues (A1), service tickets (A3),
// federated record mirrors (B3), and federation links (B2) all derive
// customer/site routing the same way — instead of each reaching into
// discovery-named internals or re-deriving the `customer:<id>:site:<id>` key.
//
// Canonical scope always lives on the owning row (EdgeNode, InventoryEntity,
// ServiceTicket, FederationLink), which already carries
// (customerAccountId, customerSiteId). This module only DERIVES routing fields
// from those columns; it never invents scope from a request body.

import {
  type DiscoveryScopeContext,
  buildDiscoveryScopeKey,
  resolveDiscoveryScopeFromIds,
  scopeFieldsFromContext,
} from "./discovery-scope";

/** Re-exported under the estate vocabulary so federation/service-desk code does
 *  not import "discovery" types for non-discovery routing. */
export type EstateScopeContext = DiscoveryScopeContext;
export type EstateScopeMode = EstateScopeContext["mode"];

/** Any row that carries customer/site columns can be resolved for routing. */
export interface EstateScopeInput {
  customerAccountId?: string | null;
  customerSiteId?: string | null;
}

export interface EstateRoutingFields {
  scopeKey: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
  scopeMode: EstateScopeMode;
}

/**
 * Resolve the scope context from the (account, site) a source row carries.
 *
 * Fail-safe parity with `resolveDiscoveryScopeFromIds`: a bare site with no
 * account degrades to organization-internal rather than fabricating a customer
 * scope (MSP segmentation spec §8.1 invariant 3 — customer scope REQUIRES an
 * account; a site alone is not a valid customer scope).
 */
export function resolveEstateScope(input: EstateScopeInput): EstateScopeContext {
  return resolveDiscoveryScopeFromIds({
    customerAccountId: input.customerAccountId ?? null,
    customerSiteId: input.customerSiteId ?? null,
  });
}

/** Denormalized routing columns for a read model (quality issue, ticket, …). */
export function estateRoutingFields(input: EstateScopeInput): EstateRoutingFields {
  const scope = resolveEstateScope(input);
  const fields = scopeFieldsFromContext(scope);
  return { ...fields, scopeMode: scope.mode };
}

/** The scope key alone (e.g. `customer:acc_1:site:s_1` / `organization:internal`). */
export function estateScopeKey(input: EstateScopeInput): string {
  return buildDiscoveryScopeKey(resolveEstateScope(input));
}

/** True when the row belongs to a managed customer estate, not the operator's own. */
export function isCustomerScoped(input: EstateScopeInput): boolean {
  return resolveEstateScope(input).mode !== "organization-internal";
}

/** Short human label for scope headers / badges (UX surfaces). */
export function describeEstateScope(input: EstateScopeInput): string {
  const scope = resolveEstateScope(input);
  if (scope.mode === "organization-internal") return "Internal estate";
  if (scope.mode === "customer-account") return `Customer ${scope.customerAccountId}`;
  return `Customer ${scope.customerAccountId} · site ${scope.customerSiteId}`;
}
