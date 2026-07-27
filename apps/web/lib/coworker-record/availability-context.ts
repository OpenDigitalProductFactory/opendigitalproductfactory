import { prisma } from "@dpf/db";

import {
  resolveInstallArchetypeContext,
  type CoworkerInstallArchetypeResolution,
} from "@/lib/coworker-service-catalog/availability-projection";

export async function loadInstallAvailabilityContext(): Promise<CoworkerInstallArchetypeResolution> {
  const organization = await prisma.organization
    .findFirst({ select: { id: true } })
    .catch(() => null);
  if (!organization) {
    return {
      install: null,
      installResolutionReason: "No organization is configured for this install.",
    };
  }
  return resolveInstallArchetypeContext(prisma, organization.id);
}
