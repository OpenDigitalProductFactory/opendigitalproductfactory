import type { ArchetypeProcessProfile } from "@dpf/storefront-templates";

export const ADMIN_RESOURCE_ROSTER_LIMIT = 5_000;

export interface AdminResourceProfile {
  kindSlug: string;
  capacityUnit: string;
  maxCapacity: number;
}

export function resolveAdminResourceProfile(
  processProfile:
    | { resourceKinds: readonly ArchetypeProcessProfile["resourceKinds"][number][] }
    | null
    | undefined,
  kindSlug: string,
): AdminResourceProfile | null {
  const configured = processProfile?.resourceKinds.find(
    (resourceKind) => resourceKind.kindSlug === kindSlug,
  );
  return configured
    ? {
        kindSlug: configured.kindSlug,
        capacityUnit: configured.capacityUnit,
        maxCapacity: configured.maxCapacity,
      }
    : null;
}

export function isAdminResourceCapacityValid(
  value: unknown,
  profile: AdminResourceProfile,
): value is number {
  return (
    Number.isInteger(value) &&
    Number(value) >= 1 &&
    Number(value) <= profile.maxCapacity
  );
}

export function assertAdminRosterWithinLimit(rowCount: number): void {
  if (rowCount > ADMIN_RESOURCE_ROSTER_LIMIT) {
    throw new Error("RESOURCE_ROSTER_LIMIT");
  }
}

export function clonePublicId(
  sourceRef: string | null,
  cloneModel: string,
  fallbackId: string,
): string {
  const prefix = `${cloneModel}:`;
  return sourceRef?.startsWith(prefix) ? sourceRef.slice(prefix.length) : fallbackId;
}
