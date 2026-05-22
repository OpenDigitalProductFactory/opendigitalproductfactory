import { describe, expect, it } from "vitest";

import {
  buildDiscoveryScopeKey,
  buildScopedInventoryEntityKey,
  buildScopedRelationshipKey,
  resolveDiscoveryScopeFromIds,
  scopeFieldsFromContext,
  type DiscoveryScopeContext,
} from "../src/discovery-scope";

const customerA: DiscoveryScopeContext = {
  mode: "customer-site",
  customerAccountId: "cust_a",
  customerSiteId: "site_austin",
};

const customerB: DiscoveryScopeContext = {
  mode: "customer-site",
  customerAccountId: "cust_b",
  customerSiteId: "site_round_rock",
};

describe("discovery scope helpers", () => {
  it("builds stable keys for internal, customer account, and customer site scopes", () => {
    expect(buildDiscoveryScopeKey({ mode: "organization-internal" })).toBe("organization:internal");
    expect(buildDiscoveryScopeKey({ mode: "customer-account", customerAccountId: "cust_a" })).toBe(
      "customer:cust_a",
    );
    expect(buildDiscoveryScopeKey(customerA)).toBe("customer:cust_a:site:site_austin");
  });

  it("keeps the same private IP distinct across customer estates", () => {
    const a = buildScopedInventoryEntityKey({
      scope: customerA,
      entityType: "host",
      naturalKey: "arp:192.168.1.1",
    });
    const b = buildScopedInventoryEntityKey({
      scope: customerB,
      entityType: "host",
      naturalKey: "arp:192.168.1.1",
    });
    const internal = buildScopedInventoryEntityKey({
      scope: { mode: "organization-internal" },
      entityType: "host",
      naturalKey: "arp:192.168.1.1",
    });

    expect(a).toBe("customer:cust_a:site:site_austin:host:arp:192.168.1.1");
    expect(b).toBe("customer:cust_b:site:site_round_rock:host:arp:192.168.1.1");
    expect(internal).toBe("organization:internal:host:arp:192.168.1.1");
    expect(new Set([a, b, internal]).size).toBe(3);
  });

  it("builds relationship keys from scoped endpoint keys", () => {
    expect(
      buildScopedRelationshipKey({
        scope: customerA,
        relationshipType: "ROUTES_THROUGH",
        fromEntityKey: "customer:cust_a:site:site_austin:host:arp:192.168.1.22",
        toEntityKey: "customer:cust_a:site:site_austin:gateway:arp:192.168.1.1",
      }),
    ).toBe(
      "customer:cust_a:site:site_austin:ROUTES_THROUGH:customer:cust_a:site:site_austin:host:arp:192.168.1.22->customer:cust_a:site:site_austin:gateway:arp:192.168.1.1",
    );
  });

  it("scopeFieldsFromContext exposes customer ids only when applicable", () => {
    expect(scopeFieldsFromContext({ mode: "organization-internal" })).toEqual({
      scopeKey: "organization:internal",
      customerAccountId: null,
      customerSiteId: null,
    });

    expect(scopeFieldsFromContext({ mode: "customer-account", customerAccountId: "cust_a" })).toEqual({
      scopeKey: "customer:cust_a",
      customerAccountId: "cust_a",
      customerSiteId: null,
    });

    expect(scopeFieldsFromContext(customerA)).toEqual({
      scopeKey: "customer:cust_a:site:site_austin",
      customerAccountId: "cust_a",
      customerSiteId: "site_austin",
    });
  });

  it("resolveDiscoveryScopeFromIds collapses nullable fields back to a typed context", () => {
    expect(resolveDiscoveryScopeFromIds({})).toEqual({ mode: "organization-internal" });
    expect(resolveDiscoveryScopeFromIds({ customerAccountId: "cust_a" })).toEqual({
      mode: "customer-account",
      customerAccountId: "cust_a",
    });
    expect(
      resolveDiscoveryScopeFromIds({ customerAccountId: "cust_a", customerSiteId: "site_austin" }),
    ).toEqual({
      mode: "customer-site",
      customerAccountId: "cust_a",
      customerSiteId: "site_austin",
    });
    // A site without an account is treated as internal — the type system already forbids it,
    // and runtime nulls flow through that branch.
    expect(resolveDiscoveryScopeFromIds({ customerSiteId: "site_austin" })).toEqual({
      mode: "organization-internal",
    });
  });
});
