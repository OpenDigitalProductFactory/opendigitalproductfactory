// apps/web/lib/business-activity-sim/oracles.ts
//
// Financial + lifecycle oracles for the business-activity flows (P1 field-service;
// generalized to every archetype in P2). EP-BUSINESS-ACTIVITY-SIM.
//
// Each oracle is a pure predicate over a FinancialFlowShape (the shared shape both
// P1's FieldServiceFlowResult and P2's ArchetypeFlowResult satisfy) that names
// exactly what broke, so a failing coverage run is diagnosable. Modelled on the
// existing dispatch harness (packages/coworker-sim-harness/src/oracles.ts): a
// harness whose oracles cannot catch a broken flow is useless — the negative
// tests prove they can.

import { toMinorUnits } from "@/lib/finance/ledger";
import { SIM_ACCOUNTS } from "./field-service-flow";
import { type FinancialFlowShape } from "./billing-cycle";

export type SimOracleResult = {
  id: string;
  description: string;
  ok: boolean;
  violations: string[];
};

export type SimOracle = (result: FinancialFlowShape) => SimOracleResult;

/** Equal to the cent — compares in integer minor units so float drift never lies. */
function moneyEq(a: number, b: number): boolean {
  return toMinorUnits(a) === toMinorUnits(b);
}

/** FIN1 — the ledger is internally consistent (total debits === total credits). */
export const FIN1_ledgerBalanced: SimOracle = (r) => {
  const violations: string[] = [];
  if (!r.trialBalance.balanced) {
    violations.push(
      `trial balance unbalanced: debits ${r.trialBalance.totalDebit.toFixed(2)} ≠ credits ${r.trialBalance.totalCredit.toFixed(2)}`,
    );
  }
  return { id: "FIN1", description: "the ledger balances (debits = credits)", ok: violations.length === 0, violations };
};

/** FIN2 — revenue recognised equals the net-of-tax subtotal (tax is a liability, not income). */
export const FIN2_revenueRecognized: SimOracle = (r) => {
  const violations: string[] = [];
  if (!moneyEq(r.revenueRecognized, r.subtotal)) {
    violations.push(`revenue recognised ${r.revenueRecognized.toFixed(2)} ≠ subtotal ${r.subtotal.toFixed(2)}`);
  }
  return { id: "FIN2", description: "revenue recognised equals the net subtotal", ok: violations.length === 0, violations };
};

/** FIN3 — the outstanding receivable equals exactly what the customer has not paid. */
export const FIN3_receivableReconciles: SimOracle = (r) => {
  const violations: string[] = [];
  const expectedOutstanding = Math.max(r.gross - r.paymentAmount, 0);
  if (!moneyEq(r.receivableBalance, expectedOutstanding)) {
    violations.push(
      `receivable ${r.receivableBalance.toFixed(2)} ≠ outstanding (gross ${r.gross.toFixed(2)} − paid ${r.paymentAmount.toFixed(2)} = ${expectedOutstanding.toFixed(2)})`,
    );
  }
  return { id: "FIN3", description: "outstanding receivable equals gross − paid", ok: violations.length === 0, violations };
};

/** FIN4 — cash received into the bank equals the payment amount. */
export const FIN4_cashMatchesPayment: SimOracle = (r) => {
  const violations: string[] = [];
  if (!moneyEq(r.cashReceived, r.paymentAmount)) {
    violations.push(`cash received ${r.cashReceived.toFixed(2)} ≠ payment ${r.paymentAmount.toFixed(2)}`);
  }
  return { id: "FIN4", description: "cash received equals the payment", ok: violations.length === 0, violations };
};

/** FIN5 — no phantom billing: revenue is only posted for a job that reached work-complete. */
export const FIN5_noPhantomBilling: SimOracle = (r) => {
  const violations: string[] = [];
  const revenuePosted = r.journal.some((l) => l.accountId === SIM_ACCOUNTS.revenue.accountId && (l.credit ?? 0) > 0);
  if (revenuePosted && !r.workCompletedBeforeInvoice) {
    violations.push("an invoice was raised without a completed on-site visit (phantom billing)");
  }
  return { id: "FIN5", description: "no invoice without a completed job", ok: violations.length === 0, violations };
};

/** LC1 — the flow ends in the terminal, paid state (it ran to completion). Every
 *  archetype lifecycle terminates in a status literally named "paid", so this
 *  reads the same across field-service / SaaS / retail without a per-archetype
 *  terminal predicate. */
export const LC1_terminalPaid: SimOracle = (r) => {
  const violations: string[] = [];
  if (r.finalStatus !== "paid") {
    violations.push(`flow ended in '${r.finalStatus}', expected terminal 'paid'`);
  }
  return { id: "LC1", description: "the flow ends terminal-paid", ok: violations.length === 0, violations };
};

/**
 * Every financial + lifecycle oracle. Applies to ANY archetype flow (they all
 * bill through the shared runBillingCycle and end terminal-paid). `FINANCIAL_ORACLES`
 * is the P2 name; `FIELD_SERVICE_ORACLES` is kept as a back-compat alias for P1.
 */
export const FINANCIAL_ORACLES: SimOracle[] = [
  FIN1_ledgerBalanced,
  FIN2_revenueRecognized,
  FIN3_receivableReconciles,
  FIN4_cashMatchesPayment,
  FIN5_noPhantomBilling,
  LC1_terminalPaid,
];

/** @deprecated P1 name — use FINANCIAL_ORACLES. Retained so P1 imports keep working. */
export const FIELD_SERVICE_ORACLES = FINANCIAL_ORACLES;
