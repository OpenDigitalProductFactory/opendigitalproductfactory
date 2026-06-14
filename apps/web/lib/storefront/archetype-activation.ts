import {
  activationHasCapability,
  getCapabilityActivation,
  getCapabilityApplicability,
  mergeActivationProfiles,
  readActivationProfile,
  type ActivationProfile,
  type NormalizedActivationProfile,
} from "@dpf/storefront-templates";
import { prisma } from "@dpf/db";

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
    rental: "Asset rental for a period (reserve → use → return → re-pool)",
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

/**
 * Load the composite activation profile for a storefront from its
 * StorefrontArchetypeComposition rows. Primary archetype is listed first,
 * secondaries follow in sortOrder order. Falls back to null if no composition
 * rows exist (pre-migration storefronts that haven't been backfilled).
 */
export async function getCompositeActivationProfile(
  storefrontId: string,
): Promise<ActivationProfile | null> {
  const compositions = await prisma.storefrontArchetypeComposition.findMany({
    where: { storefrontId },
    orderBy: [{ sortOrder: "asc" }],
    include: { archetype: true },
  });

  if (compositions.length === 0) return null;

  const ordered = [
    ...compositions.filter((c) => c.role === "primary"),
    ...compositions.filter((c) => c.role === "secondary"),
  ];

  const profiles = ordered
    .map((c) => readActivationProfile(c.archetype.activationProfile))
    .filter((p): p is ActivationProfile => p !== null);

  if (profiles.length === 0) return null;
  return mergeActivationProfiles(profiles);
}
