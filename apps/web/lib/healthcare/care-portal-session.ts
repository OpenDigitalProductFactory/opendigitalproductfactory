import { prisma } from "@dpf/db";

import type { DpfSession } from "@/lib/auth";
import { resolvePrincipalRecordIdForSessionIdentity } from "@/lib/identity/principal-linking";

export type CarePortalIdentity = {
  organizationId: string;
  actorPrincipalId: string;
};

export async function resolveCarePortalIdentity(
  user: DpfSession["user"],
): Promise<CarePortalIdentity | null> {
  if (user.type !== "customer") return null;
  const [organization, actorPrincipalId] = await Promise.all([
    prisma.organization.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
    resolvePrincipalRecordIdForSessionIdentity({ type: "customer", id: user.id }),
  ]);
  if (!organization || !actorPrincipalId) return null;
  return { organizationId: organization.id, actorPrincipalId };
}
