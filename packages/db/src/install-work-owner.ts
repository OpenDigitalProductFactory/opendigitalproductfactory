// The install's owner of automatic work when nothing better is recorded (BI-858FDE5A).
//
// Scheduled-task seeds run in packages/db and cannot read apps/web's portfolio
// owner rule, so a NEW seeded task is owned by the oldest superuser. That
// account is usually the bootstrap admin@dpf.local, which an account handover
// (BI-F25A5FC7) exists to retire: on 2026-10-07 two new seeded tasks were born
// under it six days after its work was handed over. The rule skips an account
// whose work was handed over and an inactive one. Existing tasks keep their
// owner (BI-ED055D45); this only names the owner of a task being created.
//
// apps/web's resolveWorkOwner fallback uses the same filter.

import type { PrismaClient } from "../generated/client/client";

export const INSTALL_WORK_OWNER_WHERE = { isSuperuser: true, isActive: true, workHandedOverAt: null } as const;

/**
 * When every active superuser was handed over, the oldest active superuser is
 * still returned: a seed that throws stops the whole upgrade, and an install
 * must be able to upgrade. That case is the old behaviour, not a new owner.
 */
export async function findInstallWorkOwnerUserId(prisma: Pick<PrismaClient, "user">): Promise<string | null> {
  const select = { id: true } as const;
  const orderBy = { createdAt: "asc" } as const;
  const owner = await prisma.user.findFirst({ where: INSTALL_WORK_OWNER_WHERE, orderBy, select })
    ?? await prisma.user.findFirst({ where: { isSuperuser: true, isActive: true }, orderBy, select });
  return owner?.id ?? null;
}
