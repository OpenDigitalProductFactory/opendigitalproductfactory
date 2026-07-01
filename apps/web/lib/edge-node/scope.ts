export type EdgeNodeOwnershipScope =
  | "organization"
  | "customer-account"
  | "customer-site";

export type EdgeNodeScopePolicy = {
  ownershipScope: EdgeNodeOwnershipScope;
  enforcement: "organization-scope" | "strict-customer-scope";
  source: "bootstrap-token";
  customerAccountId?: string | null;
  customerSiteId?: string | null;
};

export type EdgeNodeScopeBindingInput = {
  customerAccountId?: string | null;
  customerSiteId?: string | null;
  scopePolicy?: Record<string, unknown> | null;
  /**
   * Internal company-owned (non-MSP) estate binding. When true and no
   * customer target is supplied, the node is bound to the operator's own
   * `organization` ownership scope with an *explicit* policy, rather than
   * being left implicitly organization-scoped via an all-null binding.
   *
   * This distinguishes a node deliberately placed on the internal estate
   * from a node that is merely unscoped/unknown — a distinction the fleet
   * view, audit trail, and estate-separation boundary (EP-ESTATE-SOVEREIGNTY)
   * all need. It does NOT change request-scoping behaviour: the enforcement
   * columns (`customerAccountId`/`customerSiteId`) stay null, so an
   * organization-scoped node keeps the legacy all-null adapter path.
   *
   * Per-site/per-location granularity for the internal estate is a separate,
   * structural change (a real scope column the route filters on) — see the
   * substrate audit at
   * docs/superpowers/specs/2026-06-25-edge-node-internal-estate-per-location-substrate-audit.md.
   */
  organizationScoped?: boolean;
};

export type EdgeNodeScopeBinding = {
  customerAccountId: string | null;
  customerSiteId: string | null;
  scopePolicy: Record<string, unknown> | null;
};

function defaultScopePolicy(input: {
  customerAccountId: string | null;
  customerSiteId: string | null;
}): EdgeNodeScopePolicy | null {
  if (!input.customerAccountId && !input.customerSiteId) return null;

  return {
    ownershipScope: input.customerSiteId
      ? "customer-site"
      : "customer-account",
    enforcement: "strict-customer-scope",
    source: "bootstrap-token",
    customerAccountId: input.customerAccountId,
    customerSiteId: input.customerSiteId,
  };
}

function organizationScopePolicy(): EdgeNodeScopePolicy {
  return {
    ownershipScope: "organization",
    enforcement: "organization-scope",
    source: "bootstrap-token",
    customerAccountId: null,
    customerSiteId: null,
  };
}

export function normalizeEdgeNodeScopeBinding(
  input: EdgeNodeScopeBindingInput,
): EdgeNodeScopeBinding {
  const customerAccountId = input.customerAccountId ?? null;
  const customerSiteId = input.customerSiteId ?? null;

  if (customerSiteId && !customerAccountId) {
    throw new Error("customer-site scope requires customerAccountId");
  }

  if (input.organizationScoped && (customerAccountId || customerSiteId)) {
    throw new Error(
      "organization scope cannot carry a customer-account or customer-site target",
    );
  }

  const derivedPolicy = input.organizationScoped
    ? organizationScopePolicy()
    : defaultScopePolicy({ customerAccountId, customerSiteId });

  return {
    customerAccountId,
    customerSiteId,
    scopePolicy: input.scopePolicy ?? derivedPolicy,
  };
}
