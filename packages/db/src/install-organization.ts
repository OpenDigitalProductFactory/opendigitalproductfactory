// The install's organization, asked for by name (BI-EE2F38D5).
//
// The ratified kernel rule install-is-the-tenant (W18, DI-2DEB0D9B417F) makes
// the install the tenant: one customer, one installation, one database, one
// Organization row. Code that needs "the organization" used to call
// `organization.findFirst()` with no filter. That works only while exactly one
// row exists, and it hides the assumption: with a second row it silently
// returns whichever one the database hands back.
//
// These helpers state the assumption and enforce it. Use them instead of an
// unfiltered findFirst; scripts/check-no-unfiltered-organization-findfirst.mjs
// stops new unfiltered calls. A second organization is an anomaly to refuse
// and report, never a second tenant to pick from.

import type { Prisma, PrismaClient } from "../generated/client/client";

type OrganizationReader = Pick<PrismaClient, "organization"> | Pick<Prisma.TransactionClient, "organization">;

export class InstallOrganizationMissingError extends Error {
  readonly code = "install_organization_missing" as const;
  constructor() {
    super("This install has no Organization yet. Finish setup before calling code that needs it.");
    this.name = "InstallOrganizationMissingError";
  }
}

export class InstallOrganizationAmbiguousError extends Error {
  readonly code = "install_organization_ambiguous" as const;
  constructor() {
    super(
      "This install holds more than one Organization. The install is the tenant (kernel principle install-is-the-tenant), "
        + "so the extra row is an anomaly to investigate, not a tenant to choose between.",
    );
    this.name = "InstallOrganizationAmbiguousError";
  }
}

/**
 * The install's one Organization, or null before setup has created it.
 * Throws InstallOrganizationAmbiguousError when more than one exists.
 * Use this where "not set up yet" is a normal state (setup and onboarding).
 */
export async function findInstallOrganization<S extends Prisma.OrganizationSelect>(
  db: OrganizationReader,
  select: S,
): Promise<Prisma.OrganizationGetPayload<{ select: S }> | null> {
  const rows = await (db.organization.findMany as (args: unknown) => Promise<unknown[]>)({
    select,
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (rows.length > 1) throw new InstallOrganizationAmbiguousError();
  return (rows[0] ?? null) as Prisma.OrganizationGetPayload<{ select: S }> | null;
}

/**
 * The install's one Organization. Throws InstallOrganizationMissingError before
 * setup and InstallOrganizationAmbiguousError when more than one exists.
 */
export async function getInstallOrganization<S extends Prisma.OrganizationSelect>(
  db: OrganizationReader,
  select: S,
): Promise<Prisma.OrganizationGetPayload<{ select: S }>> {
  const organization = await findInstallOrganization(db, select);
  if (!organization) throw new InstallOrganizationMissingError();
  return organization;
}
