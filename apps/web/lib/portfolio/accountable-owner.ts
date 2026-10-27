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

import {
  activeUserOf,
  FOUNDATIONAL_PORTFOLIO_SLUG,
  PORTFOLIO_OWNER_SELECT as PORTFOLIO_SELECT,
  resolveWorkOwner,
  type WorkOwner,
  type WorkOwnerSource,
} from "@dpf/db/install-work-owner";

import { ok, type ActionFailure, type ActionSuccess } from "@/lib/shared/action-result";

// The owner walk has one home, shared with the task seeds (BI-F0E946D2).
export { FOUNDATIONAL_PORTFOLIO_SLUG, resolveWorkOwner, type WorkOwner, type WorkOwnerSource };

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
