import {
  getCapabilityActivation,
  type ArchetypeActivationProfile,
} from "@/lib/storefront/archetype-activation";

export interface CustomerEstateScopePolicy {
  mode: "organization-scope" | "strict-customer-scope";
  accountRequired: boolean;
  siteRequiredByDefault: boolean;
}

export type CustomerEstateScopeGuard =
  | {
      ok: true;
      accountId: string | null;
      siteId: string | null;
    }
  | {
      ok: false;
      reason: "customer-account-required" | "customer-site-required";
      message: string;
    };

export interface CustomerEstateScopeInput {
  accountId?: string | null;
  siteId?: string | null;
  requiresSite?: boolean;
}

function isCapabilityActive(applicability: string | null | undefined): boolean {
  return applicability === "required" || applicability === "recommended" || applicability === "optional";
}

export function resolveCustomerEstateScopePolicy(
  profile: ArchetypeActivationProfile | null | undefined,
): CustomerEstateScopePolicy {
  const customerEstate = getCapabilityActivation(profile, "customer-estate");

  if (customerEstate && isCapabilityActive(customerEstate.applicability)) {
    return {
      mode: customerEstate.isolation === "strict-customer-scope" ? "strict-customer-scope" : "organization-scope",
      accountRequired: customerEstate.isolation === "strict-customer-scope",
      siteRequiredByDefault: false,
    };
  }

  return {
    mode: "organization-scope",
    accountRequired: false,
    siteRequiredByDefault: false,
  };
}

export function requireCustomerEstateScope(
  input: CustomerEstateScopeInput,
  policy: CustomerEstateScopePolicy,
): CustomerEstateScopeGuard {
  const accountId = input.accountId ?? null;
  const siteId = input.siteId ?? null;
  const requiresSite = input.requiresSite ?? policy.siteRequiredByDefault;

  if (policy.accountRequired && !accountId) {
    return {
      ok: false,
      reason: "customer-account-required",
      message: "Select a customer account before working with this customer estate.",
    };
  }

  if (policy.accountRequired && requiresSite && !siteId) {
    return {
      ok: false,
      reason: "customer-site-required",
      message: "Select a customer site before working with this site-bound estate record.",
    };
  }

  return {
    ok: true,
    accountId,
    siteId,
  };
}
