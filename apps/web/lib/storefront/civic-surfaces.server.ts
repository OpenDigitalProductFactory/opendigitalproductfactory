import { prisma } from "@dpf/db";
import { readActivationProfile } from "@dpf/storefront-templates";
import { getEffectiveCapabilityActivations } from "@/lib/storefront/capability-activation";

/**
 * Resolve the set of capability keys that are effectively ACTIVE for the
 * install's organization — archetype-derived applicability folded with the
 * org's persisted opt-in choices (the same `resolveOrgCapabilityActivations`
 * read path the setup wizard and admin toggle use, so gating cannot drift).
 *
 * Consumed by the shell nav filter (archetype-gated entries) and by the civic
 * surface pages' server-side guards (civic spec §12: capability-driven
 * surfaces, no archetype-id conditionals).
 *
 * Returns an empty set when no storefront config / archetype profile exists
 * (pre-setup installs) — archetype-gated surfaces stay hidden.
 */
export async function getActiveOrgCapabilities(): Promise<ReadonlySet<string>> {
  const [org, config] = await Promise.all([
    prisma.organization.findFirst({ select: { id: true } }),
    prisma.storefrontConfig.findFirst({
      include: {
        archetype: { select: { archetypeId: true, activationProfile: true } },
      },
    }),
  ]);

  if (!org || !config?.archetype?.activationProfile) return new Set();

  const profile = readActivationProfile(config.archetype.activationProfile);
  if (!profile) return new Set();

  const effective = await getEffectiveCapabilityActivations(
    org.id,
    profile.capabilityActivations,
  );

  return new Set(effective.filter((a) => a.active).map((a) => a.capabilityKey));
}

/** True when the given archetype-capability is effectively active for this org. */
export async function hasActiveOrgCapability(capabilityKey: string): Promise<boolean> {
  const active = await getActiveOrgCapabilities();
  return active.has(capabilityKey);
}
