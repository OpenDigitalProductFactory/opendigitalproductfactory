import {
  getCapabilityActivation,
  type ArchetypeActivationProfile,
} from "@/lib/storefront/archetype-activation";

function isRequiredStrictCapability(
  profile: ArchetypeActivationProfile | null | undefined,
  capabilityKey: string,
): boolean {
  const capability = getCapabilityActivation(profile, capabilityKey);
  return (
    capability?.applicability === "required" &&
    capability.isolation === "strict-customer-scope"
  );
}

export function canUseCustomerNetworkTopology(
  profile: ArchetypeActivationProfile | null | undefined,
): boolean {
  return (
    isRequiredStrictCapability(profile, "customer-estate") &&
    isRequiredStrictCapability(profile, "network-inventory") &&
    getCapabilityActivation(profile, "edge-node-customer-deployment")?.applicability === "required"
  );
}
