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

export function normalizeEdgeNodeScopeBinding(
  input: EdgeNodeScopeBindingInput,
): EdgeNodeScopeBinding {
  const customerAccountId = input.customerAccountId ?? null;
  const customerSiteId = input.customerSiteId ?? null;

  if (customerSiteId && !customerAccountId) {
    throw new Error("customer-site scope requires customerAccountId");
  }

  return {
    customerAccountId,
    customerSiteId,
    scopePolicy:
      input.scopePolicy ??
      defaultScopePolicy({ customerAccountId, customerSiteId }),
  };
}
