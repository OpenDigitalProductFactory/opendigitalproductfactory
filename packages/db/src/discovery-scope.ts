export type DiscoveryScopeContext =
  | { mode: "organization-internal" }
  | { mode: "customer-account"; customerAccountId: string }
  | { mode: "customer-site"; customerAccountId: string; customerSiteId: string };

export type DiscoveryScopeFields = {
  scopeKey: string;
  customerAccountId: string | null;
  customerSiteId: string | null;
};

function normalizeScopePart(value: string): string {
  return value.trim().replace(/\s+/g, "_");
}

export function buildDiscoveryScopeKey(scope: DiscoveryScopeContext): string {
  if (scope.mode === "organization-internal") return "organization:internal";
  if (scope.mode === "customer-account") {
    return `customer:${normalizeScopePart(scope.customerAccountId)}`;
  }
  return `customer:${normalizeScopePart(scope.customerAccountId)}:site:${normalizeScopePart(scope.customerSiteId)}`;
}

export function scopeFieldsFromContext(scope: DiscoveryScopeContext): DiscoveryScopeFields {
  if (scope.mode === "organization-internal") {
    return {
      scopeKey: buildDiscoveryScopeKey(scope),
      customerAccountId: null,
      customerSiteId: null,
    };
  }

  return {
    scopeKey: buildDiscoveryScopeKey(scope),
    customerAccountId: scope.customerAccountId,
    customerSiteId: scope.mode === "customer-site" ? scope.customerSiteId : null,
  };
}

export function buildScopedInventoryEntityKey(input: {
  scope: DiscoveryScopeContext;
  entityType: string;
  naturalKey: string;
}): string {
  return [
    buildDiscoveryScopeKey(input.scope),
    normalizeScopePart(input.entityType),
    normalizeScopePart(input.naturalKey),
  ].join(":");
}

export function buildScopedRelationshipKey(input: {
  scope: DiscoveryScopeContext;
  relationshipType: string;
  fromEntityKey: string;
  toEntityKey: string;
}): string {
  return [
    buildDiscoveryScopeKey(input.scope),
    normalizeScopePart(input.relationshipType),
    `${input.fromEntityKey}->${input.toEntityKey}`,
  ].join(":");
}

export function resolveDiscoveryScopeFromIds(input: {
  customerAccountId?: string | null;
  customerSiteId?: string | null;
}): DiscoveryScopeContext {
  if (input.customerAccountId && input.customerSiteId) {
    return {
      mode: "customer-site",
      customerAccountId: input.customerAccountId,
      customerSiteId: input.customerSiteId,
    };
  }

  if (input.customerAccountId) {
    return {
      mode: "customer-account",
      customerAccountId: input.customerAccountId,
    };
  }

  return { mode: "organization-internal" };
}
