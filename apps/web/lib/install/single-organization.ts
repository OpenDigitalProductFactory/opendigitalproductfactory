// The install's organization when, and only when, the install holds exactly
// one (BI-3895E6F5). One canonical home for this invariant, shared by readers
// (lib/wiki/reader-organization.ts) and by coworker tool authority
// (lib/govern/authority/resolve-coworker-tool-authority.ts).
//
// There is no user-to-organization membership yet (BI-1B4AB42A), so this seam
// stands in for the session's organization and FAILS CLOSED: with no
// organization, or with several (an MSP install holding customer estates), it
// answers null. Picking "the oldest organization", as some single-tenant
// surfaces do, would let one customer's data or authority reach another.
//
// When BI-1B4AB42A lands, callers take the organization from the session and
// this fallback goes away.

export type SingleOrganizationClient = {
  organization: { findMany: (args: { select: { id: true }; take: number }) => Promise<Array<{ id: string }>> };
};

export async function resolveSingleInstallOrganizationId(db: SingleOrganizationClient): Promise<string | null> {
  const organizations = await db.organization.findMany({ select: { id: true }, take: 2 });
  return organizations.length === 1 ? organizations[0]!.id : null;
}
