// lib/hr/payroll-tax-emission.ts — putting payroll liabilities onto the tax
// spine that already ships (BI-947F8703).
//
// Substrate verification (2026-08-22) found the tax compliance spine is
// tax-type GENERIC, not sales-tax specific: TaxRegistration.taxType is a free
// string, TaxDecisionSnapshot/TaxLiabilityEntry carry sourceType + sourceId,
// TaxObligationPeriod already tracks due dates and notifications, and
// TaxRemittanceRun already carries executionMode, preparedByAgentId and a
// human MFA step-up on its credential.
//
// So payroll tax filing is mostly an EMITTER problem. A PayRun that writes
// snapshots with sourceType "payroll_run" reuses the entire
// accrue -> period -> due -> prepare -> approve -> file -> confirm machinery
// that already works for sales tax. This module is that emitter, kept pure so
// the mapping is testable without a database.
//
// Deposit schedules are included because a payroll deposit is not merely "the
// period total" — the cadence itself is determined by a lookback at prior
// liability, and getting that wrong is what produces late-deposit penalties.

export type PayrollTaxType =
  | "federal_withholding"
  | "social_security"
  | "medicare"
  | "futa"
  | "state_withholding"
  | "suta";

/** Who owes it. Withheld amounts are the employee's money the business holds. */
export type RemitterSide = "employee_withheld" | "employer_contribution";

export interface PayrollTaxAmount {
  taxType: PayrollTaxType;
  side: RemitterSide;
  /** Wages the tax was charged on. */
  taxableAmount: number;
  taxAmount: number;
}

export interface PayrollTaxSnapshot {
  sourceType: "payroll_run";
  sourceId: string;
  taxType: PayrollTaxType;
  side: RemitterSide;
  taxableAmount: number;
  taxAmount: number;
  occurredAt: Date;
  currency: string;
}

export interface EmittablePayRun {
  payRunId: string;
  payDate: Date;
  currency?: string;
  amounts: readonly PayrollTaxAmount[];
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Turn a pay run into tax snapshots, one per (taxType, side).
 *
 * Zero amounts are dropped: a run in a no-income-tax state should not emit an
 * empty state-withholding liability that then shows up as a period to file.
 * The occurrence date is the PAY DATE, not the period end — deposit obligations
 * are triggered by payment, not by the work being done.
 */
export function emitPayrollTaxSnapshots(run: EmittablePayRun): PayrollTaxSnapshot[] {
  const currency = run.currency ?? "USD";
  const merged = new Map<string, PayrollTaxSnapshot>();

  for (const amount of run.amounts) {
    if (amount.taxAmount === 0) continue;
    const key = `${amount.taxType}:${amount.side}`;
    const existing = merged.get(key);
    if (existing) {
      existing.taxableAmount = round2(existing.taxableAmount + amount.taxableAmount);
      existing.taxAmount = round2(existing.taxAmount + amount.taxAmount);
      continue;
    }
    merged.set(key, {
      sourceType: "payroll_run",
      sourceId: run.payRunId,
      taxType: amount.taxType,
      side: amount.side,
      taxableAmount: round2(amount.taxableAmount),
      taxAmount: round2(amount.taxAmount),
      occurredAt: run.payDate,
      currency,
    });
  }

  return [...merged.values()];
}

export type DepositCadence = "semiweekly" | "monthly";

/**
 * Determine deposit cadence from the lookback rule: a business whose total
 * liability in the lookback window exceeded the threshold deposits semiweekly,
 * otherwise monthly.
 *
 * The threshold and window are PARAMETERS, not constants, for the same reason
 * the rates are: they are set by the authority, change, and must be cited and
 * effective-dated rather than printed into source.
 */
export function determineDepositCadence(
  lookbackLiabilityTotal: number,
  semiweeklyThreshold: number,
): DepositCadence {
  return lookbackLiabilityTotal > semiweeklyThreshold ? "semiweekly" : "monthly";
}

/**
 * Total a set of snapshots for one period, split by side.
 *
 * The split matters: the employee-withheld portion is money the business is
 * holding on someone else's behalf, and reporting it merged with the employer's
 * own contribution hides that distinction from anyone reading the liability.
 */
export function summarisePeriod(snapshots: readonly PayrollTaxSnapshot[]): {
  employeeWithheld: number;
  employerContribution: number;
  total: number;
} {
  const employeeWithheld = round2(
    snapshots
      .filter((s) => s.side === "employee_withheld")
      .reduce((t, s) => t + s.taxAmount, 0),
  );
  const employerContribution = round2(
    snapshots
      .filter((s) => s.side === "employer_contribution")
      .reduce((t, s) => t + s.taxAmount, 0),
  );
  return {
    employeeWithheld,
    employerContribution,
    total: round2(employeeWithheld + employerContribution),
  };
}
