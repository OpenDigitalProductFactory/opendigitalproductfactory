// apps/web/lib/business-activity-sim/field-service-flow.ts
//
// Business Activity Simulator — field-service end-to-end flow (P1).
// EP-BUSINESS-ACTIVITY-SIM · spec: docs/superpowers/specs/2026-07-04-business-activity-simulator-design.md
//
// Composes the REAL field-dispatch lifecycle (@dpf/validators) with the REAL
// pure GL posting (@/lib/finance/ledger) into one orchestrated business flow —
// dispatched job → invoice → payment → GL — with no DB and no auth, so the
// accounting invariants of the operational spine can be asserted deterministically
// in CI. The write-side counterpart to the living-business workforce view, and the
// re-runnable confidence tool for "does the operational surface actually work?".
// Drives real capability paths; nothing here is faked but the customer + payment.

import {
  isTerminalStatus,
  isWorkComplete,
  type FieldDispatchJobStatus,
} from "@dpf/validators";
import {
  buildInvoicePostingLines,
  buildPaymentPostingLines,
  computeTrialBalance,
  type JournalLineInput,
  type LedgerAccountType,
  type TrialBalance,
  type TrialBalanceAccount,
} from "@/lib/finance/ledger";

/** Minimal fixed chart of accounts for the sim (mirrors the finance-template roles). */
export const SIM_ACCOUNTS = {
  bank: { accountId: "sim-bank", code: "1000", name: "Bank", type: "asset" },
  receivables: { accountId: "sim-ar", code: "1100", name: "Accounts Receivable", type: "asset" },
  revenue: { accountId: "sim-rev", code: "4000", name: "Service Revenue", type: "revenue" },
  taxPayable: { accountId: "sim-tax", code: "2100", name: "Sales Tax Payable", type: "liability" },
} as const satisfies Record<string, TrialBalanceAccount>;

const SIM_ACCOUNT_LIST: TrialBalanceAccount[] = Object.values(SIM_ACCOUNTS).map((a) => ({
  ...a,
  type: a.type as LedgerAccountType,
}));

export type FieldServiceScenario = {
  id: string;
  customerAccountId: string;
  /** Net-of-tax service revenue for the job (major units). */
  subtotal: number;
  /** Sales tax charged on the job (0 when none). */
  taxAmount?: number;
  /** How much the customer actually pays. Defaults to the gross (full settlement). */
  paymentAmount?: number;
};

export type FieldServiceFlowResult = {
  scenarioId: string;
  /** The lifecycle statuses the job passed through, in order. */
  lifecycle: FieldDispatchJobStatus[];
  finalStatus: FieldDispatchJobStatus;
  /** True once the job reached a work-complete state before it was invoiced. */
  workCompletedBeforeInvoice: boolean;
  journal: JournalLineInput[];
  trialBalance: TrialBalance;
  /** Revenue recognised (credit balance on the revenue account), major units. */
  revenueRecognized: number;
  /** Outstanding receivable after settlement (gross − paid when partial), major units. */
  receivableBalance: number;
  /** Cash received into the bank account, major units. */
  cashReceived: number;
  subtotal: number;
  taxAmount: number;
  gross: number;
  paymentAmount: number;
};

// The canonical happy-path lifecycle the flow drives a job through (excludes the
// cancelled / needs-review exception states). Kept local so the flow's intent is
// explicit; the vocabulary itself is owned by @dpf/validators.
const HAPPY_PATH: FieldDispatchJobStatus[] = [
  "quoted",
  "scheduled",
  "confirmed",
  "en-route",
  "on-site",
  "complete",
  "invoiced",
  "paid",
];

/**
 * Drive one field-service job through its full lifecycle and record the real GL
 * postings for the invoice (on reaching `invoiced`) and the customer receipt (on
 * reaching `paid`). Pure and deterministic — no DB, no clock, no auth — so it is
 * a CI-runnable proof of the operational spine's accounting invariants.
 */
export function runFieldServiceFlow(scenario: FieldServiceScenario): FieldServiceFlowResult {
  const subtotal = Math.max(scenario.subtotal, 0);
  const taxAmount = Math.max(scenario.taxAmount ?? 0, 0);
  const gross = subtotal + taxAmount;
  const paymentAmount = scenario.paymentAmount ?? gross;

  const journal: JournalLineInput[] = [];
  const lifecycle: FieldDispatchJobStatus[] = [];
  let workCompletedBeforeInvoice = false;

  for (const status of HAPPY_PATH) {
    lifecycle.push(status);
    if (isWorkComplete(status) && status !== "invoiced" && status !== "paid") {
      workCompletedBeforeInvoice = true;
    }
    if (status === "invoiced") {
      // SD → FI billing document: Dr AR (gross) / Cr Revenue (subtotal) / Cr Tax.
      journal.push(
        ...buildInvoicePostingLines(
          { subtotal, taxAmount, customerAccountId: scenario.customerAccountId },
          {
            revenueAccountId: SIM_ACCOUNTS.revenue.accountId,
            receivablesAccountId: SIM_ACCOUNTS.receivables.accountId,
            taxPayableAccountId: SIM_ACCOUNTS.taxPayable.accountId,
          },
        ),
      );
    }
    if (status === "paid") {
      // Customer receipt: Dr Bank / Cr AR — the settlement half of the cash cycle.
      journal.push(
        ...buildPaymentPostingLines(
          { direction: "inbound", amount: paymentAmount, customerAccountId: scenario.customerAccountId },
          {
            bankAccountId: SIM_ACCOUNTS.bank.accountId,
            receivablesAccountId: SIM_ACCOUNTS.receivables.accountId,
          },
        ),
      );
    }
  }

  const trialBalance = computeTrialBalance(SIM_ACCOUNT_LIST, journal);
  const balanceOf = (accountId: string) =>
    trialBalance.rows.find((r) => r.accountId === accountId)?.balance ?? 0;

  const finalStatus = lifecycle[lifecycle.length - 1];
  return {
    scenarioId: scenario.id,
    lifecycle,
    finalStatus,
    workCompletedBeforeInvoice,
    journal,
    trialBalance,
    revenueRecognized: balanceOf(SIM_ACCOUNTS.revenue.accountId),
    receivableBalance: balanceOf(SIM_ACCOUNTS.receivables.accountId),
    cashReceived: balanceOf(SIM_ACCOUNTS.bank.accountId),
    subtotal,
    taxAmount,
    gross,
    paymentAmount,
  };
}

/** Convenience: is the job in a terminal state at the end of the flow? */
export function flowReachedTerminal(result: FieldServiceFlowResult): boolean {
  return isTerminalStatus(result.finalStatus);
}
