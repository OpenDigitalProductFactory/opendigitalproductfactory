// Server helper — apply a customer-account status transition AND record it on the universal
// LifecycleEvent ledger with the in-stage state axis, so the account lifecycle is both moved
// and measured (two-axis reporting). BI-9078F4EE.
//
// CustomerAccount uses NATIVE decomposition: the stored `status` union carries both stage and
// in-stage state, so the grammar resolver splits it and the event's toStatus is null by design
// (status is not a backbone LifecycleStatus).

import { prisma } from "@dpf/db";
import { canAdvance } from "../lifecycle-grammar";
import { CUSTOMER_ACCOUNT_GRAMMAR, resolveCustomerAccountPoint } from "../lifecycle-grammars";

export type AccountStatusTransitionResult = { changed: boolean; reason?: string };

/**
 * Transition an account to `toStatus`, recording a LifecycleEvent atomically. Non-authoritative
 * calls are GATED by the grammar (an illegal or backward move safely no-ops); authoritative calls
 * (operator override, or a business-authoritative event such as a closed-won deal) may jump
 * stages. Idempotent: a same-status call is a no-op with no event written. The status update and
 * the ledger event are one transaction, so the ledger never records a transition that didn't land.
 */
export async function applyAccountStatusTransition(input: {
  accountId: string;
  toStatus: string;
  reason: string;
  authoritative?: boolean;
  actorPrincipalId?: string | null;
}): Promise<AccountStatusTransitionResult> {
  const account = await prisma.customerAccount.findUnique({
    where: { id: input.accountId },
    select: { status: true },
  });
  if (!account) return { changed: false, reason: "account not found" };
  if (account.status === input.toStatus) return { changed: false };

  const from = resolveCustomerAccountPoint(account.status);
  const to = resolveCustomerAccountPoint(input.toStatus);

  // Gate a non-authoritative (assistive) signal: an illegal or backward move no-ops so, e.g., an
  // opportunity opened on an already-active account does not pull it back to `qualified`.
  if (!input.authoritative && from.stage !== to.stage) {
    const check = canAdvance(CUSTOMER_ACCOUNT_GRAMMAR, from, to.stage);
    if (!check.allowed) return { changed: false, reason: check.reason };
  }

  await prisma.$transaction([
    prisma.customerAccount.update({
      where: { id: input.accountId },
      data: { status: input.toStatus },
    }),
    prisma.lifecycleEvent.create({
      data: {
        governedThingKind: "CustomerAccount",
        governedThingId: input.accountId,
        fromStage: from.stage,
        toStage: to.stage,
        fromState: from.state,
        toState: to.state,
        reason: input.reason,
        actorPrincipalId: input.actorPrincipalId ?? null,
      },
    }),
  ]);
  return { changed: true };
}

/**
 * Best-effort assistive signals wired into the opportunity lifecycle. These NEVER throw: a
 * lifecycle-signal failure must not fail the operator's primary CRM action (the opportunity was
 * already created/closed). A failure is swallowed; the transition is advisory.
 */
export async function qualifyAccountFromOpportunity(accountId: string, opportunityTitle: string): Promise<void> {
  try {
    await applyAccountStatusTransition({
      accountId,
      toStatus: "qualified",
      reason: `Opportunity "${opportunityTitle}" opened`,
    });
  } catch {
    /* assistive signal — never fail the caller's primary action */
  }
}

export async function activateAccountFromWonDeal(accountId: string, opportunityTitle: string): Promise<void> {
  try {
    await applyAccountStatusTransition({
      accountId,
      toStatus: "active",
      reason: `Opportunity "${opportunityTitle}" won`,
      authoritative: true,
    });
  } catch {
    /* assistive signal — never fail the caller's primary action */
  }
}
