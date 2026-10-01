"use server";

import { prisma } from "@dpf/db";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
import { slugify } from "@/lib/shared/slugify";
import { hashPassword } from "../password";
import { linkSetupToOrg, linkSetupToUser } from "./setup-progress";

const BOOTSTRAP_PLATFORM_ORG_ID = "ORG-PLATFORM";

/**
 * Create or upgrade the single Organization record from Step 1 data.
 * `orgId` is a human-readable unique identifier derived from timestamp.
 * `slug` is derived from the org name; a suffix is appended on collision.
 */
export async function createOrganization(
  setupId: string,
  data: {
    orgName: string;
    industry?: string;
    location?: string;
    timezone?: string;
  },
) {
  const baseSlug = slugify(data.orgName);

  const existingOrg = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, orgId: true },
  });

  // Resolve slug uniqueness by appending a numeric suffix if needed
  let slug = baseSlug;
  let attempt = 0;
  while (true) {
    const found = await prisma.organization.findUnique({ where: { slug } });
    if (!found || found.id === existingOrg?.id) break;
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const orgData = {
    orgId:
      existingOrg?.orgId === BOOTSTRAP_PLATFORM_ORG_ID
        ? `ORG-${Date.now()}`
        : (existingOrg?.orgId ?? `ORG-${Date.now()}`),
    name: data.orgName,
    slug,
    industry: data.industry ?? null,
    address: data.location
      ? ({ location: data.location, timezone: data.timezone } as Record<string, string>)
      : undefined,
  };

  const org = existingOrg
    ? await prisma.organization.update({
        where: { id: existingOrg.id },
        data: orgData,
      })
    : await prisma.organization.create({
        data: orgData,
      });

  await linkSetupToOrg(setupId, org.id);
  return org;
}

/**
 * Create the User (owner) record from Step 2 data.
 * Sets isSuperuser=true so the first user has full platform access.
 *
 * Auto-login is handled client-side: after this action succeeds the client
 * calls `signIn("workforce", { email, password })` from next-auth/react.
 */
export async function createOwnerAccount(
  setupId: string,
  data: { name: string; email: string; password: string },
) {
  // If user already exists (e.g., re-running setup), link to existing account
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    await linkSetupToUser(setupId, existing.id);
    await recordOwnerAsAccountableIfUnset(setupId, existing.id);
    return { userId: existing.id, email: existing.email };
  }

  const passwordHash = await hashPassword(data.password);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      isSuperuser: true,
      isActive: true,
    },
  });

  await linkSetupToUser(setupId, user.id);
  await recordOwnerAsAccountableIfUnset(setupId, user.id);

  return { userId: user.id, email: user.email };
}

/**
 * Record the setup owner as the organization's accountable owner
 * (Organization.topAccountablePrincipalId) — only while nothing is recorded.
 * The null guard sits in the UPDATE's WHERE clause, so a choice already made
 * (including one changed later in Admin › Settings) is never overwritten.
 *
 * Links the owner's human Principal now rather than at first sign-in: every
 * human-creation path produces its Principal (BI-4150F4D6), and the FK needs
 * Principal.id. Best-effort like the other creation paths — a linking failure
 * must not strand setup; the organization then reads as having no accountable
 * owner, which Admin › Settings offers to set.
 */
async function recordOwnerAsAccountableIfUnset(setupId: string, userId: string): Promise<void> {
  try {
    const principal = await syncUserPrincipal(userId);
    if (principal.kind !== "human" || principal.status !== "active") return;

    const progress = await prisma.platformSetupProgress.findUnique({
      where: { id: setupId },
      select: { organizationId: true },
    });
    const organizationId =
      progress?.organizationId ??
      (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
    if (!organizationId) return;

    await prisma.organization.updateMany({
      where: { id: organizationId, topAccountablePrincipalId: null },
      data: { topAccountablePrincipalId: principal.id },
    });
  } catch (error) {
    console.error("[createOwnerAccount] could not record the accountable owner", error);
  }
}
