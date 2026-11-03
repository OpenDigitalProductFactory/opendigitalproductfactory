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
// That guess is the last rung. The owner of a new task is named by the
// portfolio owner walk (resolveWorkOwner, BI-67B27832): the work's portfolio,
// then Foundational, then the organization's accountable person, then the
// guess. The walk lives here so the task seeds and apps/web read one rule; a
// separate seed guess gave client-capability-reverify-weekly to the
// next-oldest superuser on 2026-10-16 (BI-F0E946D2).

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

/** The Foundational portfolio holds the platform's own work. */
export const FOUNDATIONAL_PORTFOLIO_SLUG = "foundational";

export type WorkOwnerSource = "portfolio" | "foundational" | "organization" | "fallback";

export type WorkOwner = { userId: string; source: WorkOwnerSource };

/** Structural: the Prisma client and apps/web's fakes both satisfy it. */
export type WorkOwnerDb = {
  portfolio: { findUnique(args: unknown): Promise<{ id: string; slug: string; accountablePrincipalId: string | null } | null> };
  organization: { findFirst(args: unknown): Promise<{ topAccountablePrincipalId: string | null } | null> };
  principalAlias: { findFirst(args: unknown): Promise<{ aliasValue: string } | null> };
  user: { findFirst(args: unknown): Promise<{ id: string } | null> };
};

export const PORTFOLIO_OWNER_SELECT = { id: true, slug: true, accountablePrincipalId: true } as const;

/** The active account of an active person, or null. */
export async function activeUserOf(db: Pick<WorkOwnerDb, "principalAlias" | "user">, principalId: string | null | undefined): Promise<string | null> {
  if (!principalId) return null;
  const alias = await db.principalAlias.findFirst({
    where: { principalId, aliasType: "user", principal: { kind: "human", status: "active" } },
    select: { aliasValue: true },
  });
  if (!alias) return null;
  const user = await db.user.findFirst({ where: { id: alias.aliasValue, isActive: true }, select: { id: true } });
  return user?.id ?? null;
}

/**
 * The User that owns a piece of automatic work. Pass the work's portfolio when
 * it has one; platform jobs pass nothing and land on Foundational.
 */
export async function resolveWorkOwner(db: WorkOwnerDb, input: { portfolioId?: string | null }): Promise<WorkOwner> {
  if (input.portfolioId) {
    const portfolio = await db.portfolio.findUnique({ where: { id: input.portfolioId }, select: PORTFOLIO_OWNER_SELECT });
    const userId = await activeUserOf(db, portfolio?.accountablePrincipalId);
    if (userId) return { userId, source: "portfolio" };
  }

  const foundational = await db.portfolio.findUnique({
    where: { slug: FOUNDATIONAL_PORTFOLIO_SLUG },
    select: PORTFOLIO_OWNER_SELECT,
  });
  const foundationalOwner = await activeUserOf(db, foundational?.accountablePrincipalId);
  if (foundationalOwner) return { userId: foundationalOwner, source: "foundational" };

  const org = await db.organization.findFirst({ select: { topAccountablePrincipalId: true } });
  const orgOwner = await activeUserOf(db, org?.topAccountablePrincipalId);
  if (orgOwner) return { userId: orgOwner, source: "organization" };

  // Nothing is recorded. Keep work running under the install owner the platform
  // used before, but say so: callers and surfaces report `fallback` as a gap.
  const guess = await findInstallWorkOwnerUserId(db as never);
  if (guess) return { userId: guess, source: "fallback" };

  throw new Error("No accountable owner is recorded and no active superuser exists to own automatic work.");
}

/** The owner of a NEW seeded platform task; null when the install has nobody at all. */
export async function findTaskOwnerUserId(db: WorkOwnerDb): Promise<string | null> {
  const owner = await resolveWorkOwner(db, {}).catch(() => null);
  return owner?.userId ?? null;
}
