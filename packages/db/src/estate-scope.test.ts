import { describe, expect, it } from "vitest";
import {
  describeEstateScope,
  estateRoutingFields,
  estateScopeKey,
  isCustomerScoped,
  resolveEstateScope,
} from "./estate-scope";

describe("estate-scope resolver (WS-0 / BI-B59A09C3)", () => {
  it("resolves account + site to customer-site scope", () => {
    const scope = resolveEstateScope({ customerAccountId: "acc_1", customerSiteId: "site_1" });
    expect(scope).toEqual({
      mode: "customer-site",
      customerAccountId: "acc_1",
      customerSiteId: "site_1",
    });
  });

  it("resolves account-only to customer-account scope", () => {
    expect(resolveEstateScope({ customerAccountId: "acc_1" })).toEqual({
      mode: "customer-account",
      customerAccountId: "acc_1",
    });
  });

  it("resolves empty to organization-internal", () => {
    expect(resolveEstateScope({})).toEqual({ mode: "organization-internal" });
    expect(resolveEstateScope({ customerAccountId: null, customerSiteId: null })).toEqual({
      mode: "organization-internal",
    });
  });

  it("fails safe: a bare site with no account degrades to internal, never fabricates a customer", () => {
    // MSP segmentation spec §8.1 invariant 3 — customer scope REQUIRES an account.
    const scope = resolveEstateScope({ customerSiteId: "site_orphan" });
    expect(scope.mode).toBe("organization-internal");
  });

  it("produces stable, collision-free scope keys", () => {
    expect(estateScopeKey({ customerAccountId: "acc_a", customerSiteId: "s1" })).toBe(
      "customer:acc_a:site:s1",
    );
    expect(estateScopeKey({ customerAccountId: "acc_b", customerSiteId: "s1" })).toBe(
      "customer:acc_b:site:s1",
    );
    expect(estateScopeKey({})).toBe("organization:internal");
    // Two customers, same site label -> distinct keys (the isolation invariant).
    expect(estateScopeKey({ customerAccountId: "acc_a", customerSiteId: "s1" })).not.toBe(
      estateScopeKey({ customerAccountId: "acc_b", customerSiteId: "s1" }),
    );
  });

  it("emits denormalized routing fields for a read model", () => {
    expect(estateRoutingFields({ customerAccountId: "acc_1", customerSiteId: "site_1" })).toEqual({
      scopeKey: "customer:acc_1:site:site_1",
      customerAccountId: "acc_1",
      customerSiteId: "site_1",
      scopeMode: "customer-site",
    });
    expect(estateRoutingFields({})).toEqual({
      scopeKey: "organization:internal",
      customerAccountId: null,
      customerSiteId: null,
      scopeMode: "organization-internal",
    });
  });

  it("classifies customer-scoped vs internal and labels for UX", () => {
    expect(isCustomerScoped({ customerAccountId: "acc_1" })).toBe(true);
    expect(isCustomerScoped({})).toBe(false);
    expect(describeEstateScope({})).toBe("Internal estate");
    expect(describeEstateScope({ customerAccountId: "acc_1", customerSiteId: "site_1" })).toBe(
      "Customer acc_1 · site site_1",
    );
  });
});
