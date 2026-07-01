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

  it("mints an explicit organization policy for internal-estate nodes", () => {
    expect(
      normalizeEdgeNodeScopeBinding({ organizationScoped: true }),
    ).toEqual({
      customerAccountId: null,
      customerSiteId: null,
      scopePolicy: {
        ownershipScope: "organization",
        enforcement: "organization-scope",
        source: "bootstrap-token",
        customerAccountId: null,
        customerSiteId: null,
      },
    });
  });

  it("leaves enforcement columns null for an organization-scoped node", () => {
    // The adapters route keys on customerAccountId/customerSiteId, so an
    // internal-estate node must keep both null to retain the legacy
    // all-null (organization) adapter path even though its policy is explicit.
    const binding = normalizeEdgeNodeScopeBinding({ organizationScoped: true });
    expect(binding.customerAccountId).toBeNull();
    expect(binding.customerSiteId).toBeNull();
  });

  it("rejects mixing organization scope with a customer target", () => {
    expect(() =>
      normalizeEdgeNodeScopeBinding({
        organizationScoped: true,
        customerAccountId: "cust_acme",
      }),
    ).toThrow(
      "organization scope cannot carry a customer-account or customer-site target",
    );
  });

  it("still leaves a bare binding unbound (back-compat)", () => {
    expect(normalizeEdgeNodeScopeBinding({ organizationScoped: false })).toEqual(
      {
        customerAccountId: null,
        customerSiteId: null,
        scopePolicy: null,
      },
    );
  });
});
