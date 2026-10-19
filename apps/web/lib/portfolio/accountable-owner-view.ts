// The owner view of the portfolios (BI-67B27832): who answers for each
// portfolio's automatic work, and where that work goes while nobody is chosen.
//
// Read-only. The write is setPortfolioOwner (accountable-owner.ts).

import { resolveWorkOwner, type AccountableOwnerDb, type WorkOwnerSource } from "./accountable-owner";

export type OwnerCandidate = { principalId: string; displayName: string; email: string };

export type PortfolioOwnershipRow = {
  portfolioId: string;
  slug: string;
  name: string;
  owner: { principalId: string; displayName: string } | null;
  setAt: string | null;
  reason: string | null;
};

export type PortfolioOwnershipView = {
  rows: PortfolioOwnershipRow[];
  /** Who gets a portfolio's automatic work while it has no owner. */
  standIn: { email: string; source: WorkOwnerSource } | null;
  /** People who can be made accountable: active, with an active account. */
  candidates: OwnerCandidate[];
};

type PortfolioRow = {
  id: string;
  slug: string;
  name: string;
  accountableSetAt: Date | null;
  accountableReason: string | null;
  accountablePrincipal: { principalId: string; displayName: string } | null;
};

/** Pure: order the rows and shape them for the surface. */
export function projectPortfolioOwnership(
  portfolios: PortfolioRow[],
  candidates: OwnerCandidate[],
  standIn: PortfolioOwnershipView["standIn"],
): PortfolioOwnershipView {
  return {
    rows: [...portfolios]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({
        portfolioId: p.id,
        slug: p.slug,
        name: p.name,
        owner: p.accountablePrincipal,
        setAt: p.accountableSetAt?.toISOString() ?? null,
        reason: p.accountableReason,
      })),
    standIn,
    candidates: [...candidates].sort((a, b) => a.displayName.localeCompare(b.displayName)),
  };
}

type ViewDb = AccountableOwnerDb & {
  portfolio: AccountableOwnerDb["portfolio"] & { findMany(args: unknown): Promise<PortfolioRow[]> };
  principal: AccountableOwnerDb["principal"] & {
    findMany(args: unknown): Promise<Array<{ principalId: string; displayName: string; aliases: Array<{ aliasValue: string }> }>>;
  };
  user: AccountableOwnerDb["user"] & {
    findMany(args: unknown): Promise<Array<{ id: string; email: string }>>;
    findUnique(args: unknown): Promise<{ email: string } | null>;
  };
};

export async function loadPortfolioOwnership(db: ViewDb): Promise<PortfolioOwnershipView> {
  const [portfolios, people] = await Promise.all([
    db.portfolio.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        accountableSetAt: true,
        accountableReason: true,
        accountablePrincipal: { select: { principalId: true, displayName: true } },
      },
    }),
    db.principal.findMany({
      where: { kind: "human", status: "active", aliases: { some: { aliasType: "user" } } },
      select: { principalId: true, displayName: true, aliases: { where: { aliasType: "user" }, select: { aliasValue: true } } },
    }),
  ]);
  const userIds = people.flatMap((p) => p.aliases.map((a) => a.aliasValue));
  const activeUsers = await db.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true, email: true } });
  const emailById = new Map(activeUsers.map((u) => [u.id, u.email]));
  const candidates = people.flatMap((p) => {
    const email = p.aliases.map((a) => emailById.get(a.aliasValue)).find(Boolean);
    return email ? [{ principalId: p.principalId, displayName: p.displayName, email }] : [];
  });

  let standIn: PortfolioOwnershipView["standIn"] = null;
  try {
    const owner = await resolveWorkOwner(db, {});
    const user = await db.user.findUnique({ where: { id: owner.userId }, select: { email: true } });
    if (user) standIn = { email: user.email, source: owner.source };
  } catch {
    standIn = null;
  }
  return projectPortfolioOwnership(portfolios, candidates, standIn);
}
