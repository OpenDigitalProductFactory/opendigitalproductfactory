import { describe, expect, it } from "vitest";

import { normalizeEdgeNodeScopeBinding } from "./scope";

describe("normalizeEdgeNodeScopeBinding", () => {
  it("keeps organization-scoped nodes unbound", () => {
    expect(normalizeEdgeNodeScopeBinding({})).toEqual({
      customerAccountId: null,
      customerSiteId: null,
      scopePolicy: null,
    });
  });

  it("builds strict account policy for a customer account target", () => {
    expect(
      normalizeEdgeNodeScopeBinding({
        customerAccountId: "cust_acme",
      }),
    ).toEqual({
      customerAccountId: "cust_acme",
      customerSiteId: null,
      scopePolicy: {
        ownershipScope: "customer-account",
        enforcement: "strict-customer-scope",
        source: "bootstrap-token",
        customerAccountId: "cust_acme",
        customerSiteId: null,
      },
    });
  });

  it("builds strict site policy when both customer and site targets exist", () => {
    expect(
      normalizeEdgeNodeScopeBinding({
        customerAccountId: "cust_acme",
        customerSiteId: "site_hq",
      }),
    ).toEqual({
      customerAccountId: "cust_acme",
      customerSiteId: "site_hq",
      scopePolicy: {
        ownershipScope: "customer-site",
        enforcement: "strict-customer-scope",
        source: "bootstrap-token",
        customerAccountId: "cust_acme",
        customerSiteId: "site_hq",
      },
    });
  });

  it("rejects a site target without its customer account", () => {
    expect(() =>
      normalizeEdgeNodeScopeBinding({ customerSiteId: "site_orphan" }),
    ).toThrow("customer-site scope requires customerAccountId");
  });
});
