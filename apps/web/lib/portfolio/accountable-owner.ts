// Who owns a portfolio's automatic work (BI-67B27832).
//
// Scheduled and proactive work (the daily backlog tee-up, the capacity drain,
// the skill curator, review and ship jobs) runs with nobody at the keyboard, but
// every TaskRun and build it creates needs a real owning User. That owner used
// to be "the oldest active superuser": on a standard install the seeded
// bootstrap account admin@dpf.local, which nobody signs in with. Every build it
// created, every room those builds opened, and every approval they raised went
// to an inbox nobody reads (126 of 126 builds on the live install, 187 rooms).
//
// The operator's direction (2026-09-29): ownership of automatic work aligns to
// the portfolios, where budgets and priorities are set, and there is one
// actual human accountable identity. So the owner is, in order:
//
//   1. the accountable person of the work's own portfolio;
//   2. the accountable person of the Foundational portfolio, which is where the
//      platform's own work lives, for jobs that belong to no single portfolio;
//   3. the organization's top accountable person;
//   4. only then the old guess (oldest active superuser), returned as
//      `fallback` so surfaces can show that nobody has been chosen.
//
// An owner counts only when it is an active person whose account is active: a
// retired principal or a deactivated account is skipped, never returned.
//
// Setting an owner is a governed write: a person, a reason, and a timestamp are
// recorded with it, and a coworker cannot be made accountable.

import { ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";

/** The Foundational portfolio holds the platform's own work. */
export const FOUNDATIONAL_PORTFOLIO_SLUG = "foundational";

export type WorkOwnerSource = "portfolio" | "foundational" | "organization" | "fallback";

export type WorkOwner = { userId: string; source: WorkOwnerSource };

type PrincipalRow = { id: string; kind: string; status: string; displayName: string };

export type AccountableOwnerDb = {
  portfolio: {
    findUnique(args: unknown): Promise<{ id: string; slug: string; accountablePrincipalId: string | null } | null>;
    update(args: unknown): Promise<{ id: string }>;
  };
  organization: { findFirst(args: unknown): Promise<{ topAccountablePrincipalId: string | null } | null> };
  principal: { findFirst(args: unknown): Promise<PrincipalRow | null> };
  principalAlias: { findFirst(args: unknown): Promise<{ aliasValue: string } | null> };
  user: { findFirst(args: unknown): Promise<{ id: string } | null> };
};

const PORTFOLIO_SELECT = { id: true, slug: true, accountablePrincipalId: true } as const;

/** The active account of an active person, or null. */
async function activeUserOf(db: AccountableOwnerDb, principalId: string | null | undefined): Promise<string | null> {
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
export async function resolveWorkOwner(
  db: AccountableOwnerDb,
  input: { portfolioId?: string | null },
): Promise<WorkOwner> {
  if (input.portfolioId) {
    const portfolio = await db.portfolio.findUnique({ where: { id: input.portfolioId }, select: PORTFOLIO_SELECT });
    const userId = await activeUserOf(db, portfolio?.accountablePrincipalId);
    if (userId) return { userId, source: "portfolio" };
  }

  const foundational = await db.portfolio.findUnique({
    where: { slug: FOUNDATIONAL_PORTFOLIO_SLUG },
    select: PORTFOLIO_SELECT,
  });
  const foundationalOwner = await activeUserOf(db, foundational?.accountablePrincipalId);
  if (foundationalOwner) return { userId: foundationalOwner, source: "foundational" };

  const org = await db.organization.findFirst({ select: { topAccountablePrincipalId: true } });
  const orgOwner = await activeUserOf(db, org?.topAccountablePrincipalId);
  if (orgOwner) return { userId: orgOwner, source: "organization" };

  // Nothing is recorded. Keep work running under the install owner the platform
  // used before, but say so: callers and surfaces report `fallback` as a gap.
  const guess = await db.user.findFirst({
    where: { isSuperuser: true, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (guess) return { userId: guess.id, source: "fallback" };

  throw new Error("No accountable owner is recorded and no active superuser exists to own automatic work.");
}

export type SetPortfolioOwnerInput = {
  portfolioId: string;
  /** Principal id (PRN-*) or row id of the person; null clears the owner. */
  principalRef: string | null;
  reason: string;
  actor: { userId: string | null };
  now?: Date;
};

export type SetPortfolioOwnerRefusal =
  | "reason_required"
  | "actor_required"
  | "unknown_portfolio"
  | "unknown_principal"
  | "not_a_person"
  | "not_active";

export type SetPortfolioOwnerResult =
  | ActionSuccess<{ portfolioId: string; accountablePrincipalId: string | null }>
  | (ActionFailure & { error: SetPortfolioOwnerRefusal; message: string });

function refuse(error: SetPortfolioOwnerRefusal, message: string): SetPortfolioOwnerResult {
  return { ok: false, error, message };
}

/** The governed write: one accountable person per portfolio, attributed and explained. */
export async function setPortfolioOwner(
  db: AccountableOwnerDb,
  input: SetPortfolioOwnerInput,
): Promise<SetPortfolioOwnerResult> {
  const reason = input.reason.trim();
  if (!reason) return refuse("reason_required", "Say why this person is accountable; the reason is recorded with it.");
  if (!input.actor.userId) {
    return refuse("actor_required", "A portfolio owner is chosen by a person. No person is attached to this request.");
  }
  const portfolio = await db.portfolio.findUnique({ where: { id: input.portfolioId }, select: PORTFOLIO_SELECT });
  if (!portfolio) return refuse("unknown_portfolio", `Portfolio ${input.portfolioId} does not exist.`);

  let principalId: string | null = null;
  if (input.principalRef) {
    const principal = await db.principal.findFirst({
      where: { OR: [{ id: input.principalRef }, { principalId: input.principalRef }] },
      select: { id: true, kind: true, status: true, displayName: true },
    });
    if (!principal) return refuse("unknown_principal", `No principal ${input.principalRef} exists.`);
    if (principal.kind !== "human") {
      return refuse("not_a_person", `${principal.displayName} is not a person. Only a person can be accountable for a portfolio.`);
    }
    if (principal.status !== "active" || !(await activeUserOf(db, principal.id))) {
      return refuse("not_active", `${principal.displayName} has no active account, so they could not answer for this portfolio.`);
    }
    principalId = principal.id;
  }

  await db.portfolio.update({
    where: { id: portfolio.id },
    data: {
      accountablePrincipalId: principalId,
      accountableSetById: input.actor.userId,
      accountableSetAt: input.now ?? new Date(),
      accountableReason: reason,
    },
    select: { id: true },
  });
  return ok({ portfolioId: portfolio.id, accountablePrincipalId: principalId });
}
