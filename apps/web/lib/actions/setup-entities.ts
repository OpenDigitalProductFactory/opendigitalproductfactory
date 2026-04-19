"use server";

import { prisma } from "@dpf/db";
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
  const baseSlug = data.orgName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

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

  return { userId: user.id, email: user.email };
}
