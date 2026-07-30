import type { CoworkerAvailabilityProjection } from "@/lib/coworker-service-catalog/availability-projection";
import type { CapabilityKey } from "@/lib/permissions";

export type CoworkerAvailabilityRecoveryTarget = {
  href: string;
  label: string;
  requiredCapability?: CapabilityKey;
};

export function availabilityRecoveryTarget(
  availability: CoworkerAvailabilityProjection,
  detailHref: string,
  grantedCapabilities: ReadonlySet<CapabilityKey> = new Set(),
): CoworkerAvailabilityRecoveryTarget | null {
  const recovery = availability.recovery;
  if (!recovery) return null;
  if (recovery.kind === "catalog") return null;

  const targetByKind: Record<
    Exclude<typeof recovery.kind, "catalog">,
    Omit<CoworkerAvailabilityRecoveryTarget, "label">
  > = {
    "business-type": {
      href: "/storefront/settings/business",
      requiredCapability: "view_storefront",
    },
    capabilities: {
      href: `${detailHref}#capabilities`,
      requiredCapability: "view_platform",
    },
    "capability-needs": {
      href: "/ops?origin=capability-need",
      requiredCapability: "view_operations",
    },
    lifecycle: {
      href: "/admin/scheduled-jobs#scheduled-job-coworker-certification",
      requiredCapability: "view_admin",
    },
    routing: {
      href: "/platform/ai/readiness",
      requiredCapability: "view_platform",
    },
  };
  const target = targetByKind[recovery.kind];
  if (
    target.requiredCapability &&
    !grantedCapabilities.has(target.requiredCapability)
  ) {
    return null;
  }
  return {
    ...target,
    label: recovery.label,
  };
}
