import type { CoworkerAvailabilityProjection } from "@/lib/coworker-service-catalog/availability-projection";

export type CoworkerAvailabilityRecoveryTarget = {
  href: string;
  label: string;
};

export function availabilityRecoveryTarget(
  availability: CoworkerAvailabilityProjection,
  detailHref: string,
): CoworkerAvailabilityRecoveryTarget | null {
  const recovery = availability.recovery;
  if (!recovery) return null;

  const hrefByKind: Record<typeof recovery.kind, string> = {
    "business-type": "/storefront/settings/business",
    catalog: "/platform/ai/catalog",
    capabilities: `${detailHref}#capabilities`,
    "capability-needs": "/ops?origin=capability-need",
    lifecycle: "/platform/ai/readiness",
    routing: "/platform/ai/readiness",
  };
  return {
    href: hrefByKind[recovery.kind],
    label: recovery.label,
  };
}
