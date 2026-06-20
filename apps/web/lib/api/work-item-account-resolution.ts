/**
 * WorkItem → CustomerAccount resolver.
 *
 * A WorkItem has only `sourceType` + `sourceId` to its origin — there's no
 * direct account FK. This module owns the per-source-kind lookup chain that
 * resolves the customer account for the field-tech surface so the mobile
 * invoice screen can pre-fill `accountId` from the job instead of asking the
 * tech to type it.
 *
 * Each branch is a single Prisma `findUnique`; misses return null so the
 * caller keeps working with the free-text fallback. The set of recognized
 * sourceTypes is closed to the ones whose models actually carry an account
 * link today — adding a new source means adding a branch here AND a route
 * test, not just one or the other.
 */
import { prisma } from "@dpf/db";
import type { WorkItemAccount } from "@dpf/types";

type AccountRow = {
  id: string;
  accountId: string;
  name: string;
};

function toAccount(row: AccountRow | null | undefined): WorkItemAccount | null {
  if (!row) return null;
  return { id: row.id, accountId: row.accountId, name: row.name };
}

/** Engagement is the most direct path — its `accountId` IS the FK to CustomerAccount. */
async function fromEngagement(sourceId: string): Promise<WorkItemAccount | null> {
  const row = await prisma.engagement.findUnique({
    where: { engagementId: sourceId },
    select: { account: { select: { id: true, accountId: true, name: true } } },
  });
  return toAccount(row?.account);
}

/** Opportunity.accountId is required — every Opportunity has an account. */
async function fromOpportunity(sourceId: string): Promise<WorkItemAccount | null> {
  const row = await prisma.opportunity.findUnique({
    where: { opportunityId: sourceId },
    select: { account: { select: { id: true, accountId: true, name: true } } },
  });
  return toAccount(row?.account);
}

/**
 * StorefrontBooking carries `customerContactId` as a plain column (no Prisma
 * `@relation`), so we walk in two hops: booking → contact id → contact's
 * account. Returns null at any miss along the chain.
 */
async function fromBooking(sourceId: string): Promise<WorkItemAccount | null> {
  const booking = await prisma.storefrontBooking.findUnique({
    where: { bookingRef: sourceId },
    select: { customerContactId: true },
  });
  if (!booking?.customerContactId) return null;
  const contact = await prisma.customerContact.findUnique({
    where: { id: booking.customerContactId },
    select: { account: { select: { id: true, accountId: true, name: true } } },
  });
  return toAccount(contact?.account);
}

/** Activity ties to an account through accountId directly. */
async function fromActivity(sourceId: string): Promise<WorkItemAccount | null> {
  const row = await prisma.activity.findUnique({
    where: { activityId: sourceId },
    select: { account: { select: { id: true, accountId: true, name: true } } },
  });
  return toAccount(row?.account);
}

/**
 * The set of WorkItem `sourceType` values this resolver understands. Closed
 * by design — an unknown source returns null and the tech enters the account
 * manually, rather than failing.
 */
const RESOLVERS: Record<
  string,
  (sourceId: string) => Promise<WorkItemAccount | null>
> = {
  engagement: fromEngagement,
  opportunity: fromOpportunity,
  "storefront-booking": fromBooking,
  booking: fromBooking,
  activity: fromActivity,
};

export interface ResolveWorkItemAccountInput {
  sourceType: string | null | undefined;
  sourceId: string | null | undefined;
}

/**
 * Resolve a WorkItem's customer account by walking its source link.
 * Returns null when there's no mapping or the source row no longer exists.
 */
export async function resolveWorkItemAccount(
  input: ResolveWorkItemAccountInput,
): Promise<WorkItemAccount | null> {
  const type = input.sourceType?.trim();
  const id = input.sourceId?.trim();
  if (!type || !id) return null;
  const resolver = RESOLVERS[type];
  if (!resolver) return null;
  return resolver(id);
}

/** Test-only export of the closed source-type registry. */
export const __RESOLVER_KEYS_FOR_TESTS = Object.keys(RESOLVERS);
