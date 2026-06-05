import { prisma } from "@dpf/db";
import {
  CAPABILITY_REGISTRY,
  getCapabilitySetupPrompt,
  readActivationProfile,
  type CapabilityKey,
} from "@dpf/storefront-templates";
import { CapabilityActivationToggle } from "@/components/storefront-admin/CapabilityActivationToggle";
import { getEffectiveCapabilityActivations } from "@/lib/storefront/capability-activation";

function labelFor(capabilityKey: string): string {
  const entry = CAPABILITY_REGISTRY[capabilityKey as CapabilityKey];
  if (entry) return entry.label;
  return capabilityKey
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function CapabilitiesSettingsPage() {
  const [org, storefront] = await Promise.all([
    prisma.organization.findFirst({ select: { id: true } }),
    prisma.storefrontConfig.findFirst({
      select: { archetype: { select: { activationProfile: true } } },
    }),
  ]);

  const profile = readActivationProfile(storefront?.archetype?.activationProfile);
  const derived =
    profile?.capabilityActivations.map((capability) => ({
      capabilityKey: capability.capabilityKey,
      applicability: capability.applicability,
    })) ?? [];

  const effective = org ? await getEffectiveCapabilityActivations(org.id, derived) : [];

  // Optional/recommended capabilities the org can turn on or off (the "add it
  // later" surface). `required` capabilities are core to the business model and
  // not toggled here; `not-applicable` ones have canEnableLater === false.
  const togglable = effective.filter(
    (capability) => capability.canEnableLater && capability.source !== "required",
  );

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-lg font-semibold text-[var(--dpf-text)]">Capabilities</h1>
      <p className="mb-6 text-sm text-[var(--dpf-muted)]">
        Optional capabilities for your business type. Turn one on whenever it applies — you
        can change these at any time.
      </p>

      {togglable.length === 0 ? (
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]">
          No optional capabilities for your business type yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {togglable.map((capability) => {
            const prompt = getCapabilitySetupPrompt(capability.capabilityKey);
            return (
              <li
                key={capability.capabilityKey}
                className="flex items-start justify-between gap-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-[var(--dpf-text)]">
                    {prompt?.question ?? labelFor(capability.capabilityKey)}
                  </div>
                  {prompt?.helpText && (
                    <div className="mt-1 text-xs text-[var(--dpf-muted)]">{prompt.helpText}</div>
                  )}
                </div>
                <CapabilityActivationToggle
                  capabilityKey={capability.capabilityKey}
                  active={capability.active}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
