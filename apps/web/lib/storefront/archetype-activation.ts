import {
  activationHasCapability,
  getCapabilityActivation,
  getCapabilityApplicability,
  readActivationProfile,
  type NormalizedActivationProfile,
} from "@dpf/storefront-templates";

export type ArchetypeActivationProfile = NormalizedActivationProfile;

export {
  activationHasCapability,
  getCapabilityActivation,
  getCapabilityApplicability,
  readActivationProfile,
};

export function isManagedServiceProviderProfile(
  profile: ArchetypeActivationProfile | null | undefined,
): profile is ArchetypeActivationProfile & { profileType: "managed-service-provider" } {
  return profile?.profileType === "managed-service-provider";
}

export function deriveRevenueModelFromActivationProfile(
  profile: ArchetypeActivationProfile | null | undefined,
  ctaType: string,
): string | null {
  if (isManagedServiceProviderProfile(profile)) {
    return "Managed service agreements with recurring schedules and customer-estate coverage";
  }

  const ctaRevenueModels: Record<string, string> = {
    booking: "Appointment-based services",
    purchase: "Product/service sales",
    inquiry: "Quote-based services",
    donation: "Donor-funded",
  };

  return ctaRevenueModels[ctaType] ?? null;
}

export function deriveCustomerConfigurationItemDefaults(
  profile: ArchetypeActivationProfile | null | undefined,
) {
  return {
    itemTypes: profile?.seededConfigurationItemTypes ?? [],
    billingUnitTypes: profile?.seededBillingUnitTypes ?? [],
    chargeModels: profile?.seededChargeModels ?? [],
  };
}
