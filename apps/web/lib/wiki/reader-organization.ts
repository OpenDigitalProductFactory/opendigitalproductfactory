// BI-4EAFF7AC: the organization a wiki reader reads as (spec 2026-10-14
// knowledge-linking §2 R2).
//
// R2 says the reader's organization comes from the session. The model has no
// user-to-organization membership yet (BI-1B4AB42A), so this seam stands in for
// it and fails closed: it answers only when the install holds exactly one
// organization. With none, or with several (an MSP install holding customer
// estates), it answers null and readers show no organization pages at all.
// Picking "the oldest organization" instead, as some single-tenant surfaces do,
// would show one customer's pages to another (R4).
//
// When BI-1B4AB42A lands, this resolves from the session and the single-
// organization fallback goes away; callers already pass the result through.

type ReaderOrganizationClient = {
  organization: { findMany: (args: { select: { id: true }; take: number }) => Promise<Array<{ id: string }>> };
};

export async function resolveReaderOrganizationId(db: ReaderOrganizationClient): Promise<string | null> {
  const organizations = await db.organization.findMany({ select: { id: true }, take: 2 });
  return organizations.length === 1 ? organizations[0]!.id : null;
}
