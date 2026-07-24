import { prisma } from "@dpf/db";
import { readActivationProfile } from "@dpf/storefront-templates";
import { getEffectiveCapabilityActivations } from "@/lib/storefront/capability-activation";

/**
 * Server read path for the effective archetype-capability activation of the
 * install's organization — surface-neutral home for the org-capability gate.
 *
 * Both functions here (`getActiveOrgCapabilities`, `hasActiveOrgCapability`) were
 * originally authored in `civic-surfaces.server.ts` because the civic/governance
 * archetype family was the first to need a route guard. They gate every
 * archetype family — rental, warehousing, partner, member-owned — not just civic,
 * so they live here and `civic-surfaces.server.ts` re-exports them for back-compat.
 * New consumers (route guards, API guards, coworker gating, the CI consumer guard)
 * should import from THIS module. Spec:
 * docs/superpowers/specs/2026-07-24-capability-enforcement-completion-design.md §5.2.
 *
 * The archetype derivation answers "is this capability applicable?"; the org's
 * persisted opt-in (folded in `getEffectiveCapabilityActivations`) answers "did
 * this org turn it on?". This is the same read path the setup wizard and the
 * admin add-later toggle use, so gating cannot drift from activation.
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
