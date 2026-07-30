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
  if (recovery.kind === "catalog") return null;

  const hrefByKind: Record<Exclude<typeof recovery.kind, "catalog">, string> = {
    "business-type": "/storefront/settings/business",
    capabilities: `${detailHref}#capabilities`,
    "capability-needs": "/ops?origin=capability-need",
    lifecycle:
      "/admin/scheduled-jobs#scheduled-job-coworker-certification",
    routing: "/platform/ai/readiness",
  };
  return {
    href: hrefByKind[recovery.kind],
    label: recovery.label,
  };
}
