import { describe, expect, it } from "vitest";

import { readActivationProfile } from "@/lib/storefront/archetype-activation";
import {
  requireCustomerEstateScope,
  resolveCustomerEstateScopePolicy,
} from "./scope-policy";

const mspProfile = readActivationProfile({
  profileType: "managed-service-provider",
  modules: ["customer-estate", "service-agreements", "service-operations"],
  billingReadinessMode: "prepared-not-prescribed",
  customerGraph: "separate-customer-projection",
  estateSeparation: "strict",
});

const standardProfile = readActivationProfile({
  profileType: "standard",
  modules: ["integrations"],
  billingReadinessMode: "none",
  customerGraph: "none",
  estateSeparation: "shared",
});

describe("resolveCustomerEstateScopePolicy", () => {
  it("requires strict customer account scope when customer estate is active", () => {
    expect(resolveCustomerEstateScopePolicy(mspProfile)).toMatchObject({
      mode: "strict-customer-scope",
      accountRequired: true,
      siteRequiredByDefault: false,
    });
  });

  it("allows organization scope when no customer estate capability is active", () => {
    expect(resolveCustomerEstateScopePolicy(standardProfile)).toMatchObject({
      mode: "organization-scope",
      accountRequired: false,
      siteRequiredByDefault: false,
    });
  });
});

describe("requireCustomerEstateScope", () => {
  it("returns a guard failure when MSP estate work lacks an account", () => {
    const policy = resolveCustomerEstateScopePolicy(mspProfile);

    expect(requireCustomerEstateScope({ accountId: null }, policy)).toEqual({
      ok: false,
      reason: "customer-account-required",
      message: "Select a customer account before working with this customer estate.",
    });
  });

  it("requires site scope for site-bound MSP estate work", () => {
    const policy = resolveCustomerEstateScopePolicy(mspProfile);

    expect(requireCustomerEstateScope({ accountId: "acct_1", siteId: null, requiresSite: true }, policy)).toEqual({
      ok: false,
      reason: "customer-site-required",
      message: "Select a customer site before working with this site-bound estate record.",
    });
  });

  it("passes when strict MSP scope has the required account and site", () => {
    const policy = resolveCustomerEstateScopePolicy(mspProfile);

    expect(requireCustomerEstateScope({ accountId: "acct_1", siteId: "site_1", requiresSite: true }, policy)).toEqual({
      ok: true,
      accountId: "acct_1",
      siteId: "site_1",
    });
  });

  it("passes organization-scoped work without a customer account", () => {
    const policy = resolveCustomerEstateScopePolicy(standardProfile);

    expect(requireCustomerEstateScope({}, policy)).toEqual({
      ok: true,
      accountId: null,
      siteId: null,
    });
  });
});
