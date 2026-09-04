// lib/hr/reimbursement-in-payroll.ts — approved expense claims riding a pay run
// (BI-AC74BE73, EP-PAYROLL-ABSORB x EP-MILEAGE-ABSORB).
//
// This is the seam between the two absorbed jobs: a driver's mileage is
// monetised onto an ExpenseClaim (lib/mileage/monetisation.ts), and the claim is
// then repaid through payroll rather than a separate payment run — which is how
// most small businesses actually pay expenses.
//
// The load-bearing distinction is that a reimbursement is NOT earnings. It is
// the business repaying money the employee already spent, so it must not inflate
// gross pay, must not enter the statutory tax base, and must not appear in the
// payroll tax emitters (lib/hr/payroll-tax-emission.ts). Getting this wrong
// over-taxes an employee on their own money.
//
// SCOPE BOUNDARY: reimbursement ABOVE a jurisdiction's statutory mileage rate IS
// taxable in both the US and UK, and belongs in an `earning` line rather than a
// `reimbursement` line. Computing that split needs jurisdiction-scoped banded
// rates, which is BI-1C8B56DA and is NOT implemented here. This module carries
// the seam for it (see taxableExcess) without inventing the calculation.

/** Reasons a claim is not settled through this run. Closed set. */
export type ReimbursementExclusionReason =
  | "not_approved"
  | "already_paid"
  | "zero_amount"
  | "currency_mismatch";

export type SettleableClaim = {
  claimId: string;
  employeeProfileId: string;
  title: string;
  /** Claim status: only "approved" is eligible. */
  status: string;
  totalAmount: number;
  currency: string;
  /** Non-null means it was already settled elsewhere — never pay it twice. */
  paidAt: Date | null;
};

export type ReimbursementLine = {
  /** Stable per claim, so recomputing a run is idempotent under the
   *  PayComponentLine @@unique([payslipId, code]) constraint. */
  code: string;
  label: string;
  amount: number;
  currency: string;
  componentKind: "reimbursement";
  /** Always false. A repayment of an expense is not taxable income. */
  taxable: false;
  claimId: string;
};

export type ExcludedClaim = {
  claimId: string;
  reason: ReimbursementExclusionReason;
  detail: string;
};

export type ReimbursementPlan = {
  employeeProfileId: string;
  currency: string;
  lines: ReimbursementLine[];
  /** Sum of the settled lines — what payroll adds to net pay. */
  totalReimbursement: number;
  /** Every claim that did NOT settle, with why. */
  excluded: ExcludedClaim[];
};

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** The component code a claim settles under. Deterministic by construction. */
export function reimbursementCode(claimId: string): string {
  return `REIMB-${claimId}`;
}

/**
 * Decide which approved claims settle through this pay run.
 *
 * Every input claim appears in exactly one of `lines` or `excluded` — a claim is
 * never silently dropped, because a claim that vanishes is an employee who does
 * not get paid and cannot see why.
 *
 * A claim in a currency other than the run's is REFUSED rather than converted.
 * There is no FX substrate on the platform (BI-BAC971B2: no ISO-4217 authority,
 * no rate source, no as-of provenance), so any conversion here would be an
 * uncited number attached to someone's pay.
 */
export function planReimbursements(input: {
  employeeProfileId: string;
  claims: readonly SettleableClaim[];
  /** The pay run's currency — claims must match it. */
  currency: string;
}): ReimbursementPlan {
  const lines: ReimbursementLine[] = [];
  const excluded: ExcludedClaim[] = [];

  for (const claim of input.claims) {
    if (claim.employeeProfileId !== input.employeeProfileId) continue;

    if (claim.status !== "approved") {
      excluded.push({
        claimId: claim.claimId,
        reason: "not_approved",
        detail: `status is "${claim.status}" — only an approved claim may be reimbursed`,
      });
      continue;
    }

    if (claim.paidAt !== null) {
      excluded.push({
        claimId: claim.claimId,
        reason: "already_paid",
        detail: `settled at ${claim.paidAt.toISOString()} — reimbursing again would pay it twice`,
      });
      continue;
    }

    if (claim.currency !== input.currency) {
      excluded.push({
        claimId: claim.claimId,
        reason: "currency_mismatch",
        detail: `claim is ${claim.currency}, run is ${input.currency} — no governed FX rate exists to convert it`,
      });
      continue;
    }

    const amount = round2(claim.totalAmount);
    if (amount === 0) {
      excluded.push({
        claimId: claim.claimId,
        reason: "zero_amount",
        detail: "nothing to reimburse",
      });
      continue;
    }

    lines.push({
      code: reimbursementCode(claim.claimId),
      label: claim.title,
      amount,
      currency: claim.currency,
      componentKind: "reimbursement",
      taxable: false,
      claimId: claim.claimId,
    });
  }

  return {
    employeeProfileId: input.employeeProfileId,
    currency: input.currency,
    lines,
    totalReimbursement: round2(lines.reduce((t, l) => t + l.amount, 0)),
    excluded,
  };
}

/**
 * Adapt a plan to the `reimbursements` field of PayrollPostablePayslip
 * (lib/hr/payroll-gl.ts), which debits reimbursement expense and credits net pay
 * payable without touching wages expense or the tax accounts.
 */
export function toPayComponents(
  plan: ReimbursementPlan,
): Array<{ code: string; label: string; amount: number }> {
  return plan.lines.map((l) => ({ code: l.code, label: l.label, amount: l.amount }));
}

/**
 * The claim ids this run settles. The caller marks exactly these paid in the same
 * transaction that persists the payslip, so a claim cannot be reimbursed twice by
 * a later run or by the standalone expense payment path.
 */
export function settledClaimIds(plan: ReimbursementPlan): string[] {
  return plan.lines.map((l) => l.claimId);
}

/**
 * Guard: reimbursement must never reach the statutory tax base.
 *
 * Returns the codes that wrongly appear in both the reimbursement plan and the
 * taxable earnings passed to the payroll engine. A non-empty result is a defect
 * in the caller, not a condition to tolerate — it means an employee is about to
 * be taxed on repayment of their own money.
 */
export function reimbursementCodesInTaxBase(
  plan: ReimbursementPlan,
  taxableEarnings: ReadonlyArray<{ code: string }>,
): string[] {
  const reimbursed = new Set(plan.lines.map((l) => l.code));
  return taxableEarnings.map((e) => e.code).filter((code) => reimbursed.has(code));
}
