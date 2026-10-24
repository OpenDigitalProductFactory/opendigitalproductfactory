/**
 * Read the organization's recorded top accountable human.
 *
 * This is the root of the accountability lineage that
 * `resolveEffectiveHumanAccountability` walks up to. It is deliberately a plain
 * read with no fallback: when the column is null the caller receives null and
 * the resolver returns its setup state, which is what the design asks for when
 * the binding is missing (PWA-04).
 *
 * There is no "best guess" branch here on purpose. The install's first
 * administrator, the room's creator, the requester and the lease holder are all
 * available and all wrong: presenting any of them as the accountable human turns
 * an absent decision into an apparent one.
 */

import { prisma } from "@dpf/db";

export type OrganizationAccountableDb = {
  organization: { findFirst(args: unknown): Promise<{ topAccountablePrincipalId: string | null } | null> };
};

/**
 * The recorded owner's Principal id, or null when none is recorded.
 *
 * Single organization per install, so this resolves without an argument; pass
 * `organizationId` only when a caller genuinely holds one.
 */
export async function readOrganizationTopAccountablePrincipalId(
  db: OrganizationAccountableDb = prisma as unknown as OrganizationAccountableDb,
  organizationId?: string,
): Promise<string | null> {
  const org = await db.organization.findFirst({
    ...(organizationId ? { where: { id: organizationId } } : {}),
    select: { topAccountablePrincipalId: true },
  });
  const recorded = org?.topAccountablePrincipalId?.trim();
  return recorded ? recorded : null;
}
