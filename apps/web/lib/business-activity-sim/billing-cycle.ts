// apps/web/lib/business-activity-sim/billing-cycle.ts
//
// Business Activity Simulator — the UNIVERSAL billing cycle (P2).
// EP-BUSINESS-ACTIVITY-SIM · BI-78B83F58.
//
// The invoice → payment → GL half of a business flow is the same across every
// archetype: a service/subscription/order is billed, the customer pays, and the
// ledger records Dr AR / Cr Revenue / Cr Tax then Dr Bank / Cr AR. Only the
// pre-invoice OPERATIONAL lifecycle differs by archetype (dispatch vs
// subscription vs POS). P1 proved this for field-service; P2 extracts the shared
// financial engine here so every archetype flow posts through the SAME real pure
// GL functions and the SAME oracles can score them all.

import {
  buildInvoicePostingLines,
  buildPaymentPostingLines,
  computeTrialBalance,
  type JournalLineInput,
  type LedgerAccountType,
  type TrialBalance,
  type TrialBalanceAccount,
} from "@/lib/finance/ledger";
import { SIM_ACCOUNTS } from "./field-service-flow";

// Reuse P1's fixed chart of accounts (single COA for the whole sim).
const SIM_ACCOUNT_LIST: TrialBalanceAccount[] = Object.values(SIM_ACCOUNTS).map((a) => ({
  ...a,
  type: a.type as LedgerAccountType,
}));

export type BillingInput = {
  customerAccountId: string;
  /** Net-of-tax revenue for the sale (major units). */
  subtotal: number;
  /** Sales tax charged (0 when none). */
  taxAmount?: number;
  /** How much the customer actually pays. Defaults to the gross (full settlement). */
  paymentAmount?: number;
};

export type BillingResult = {
  journal: JournalLineInput[];
  trialBalance: TrialBalance;
  subtotal: number;
  taxAmount: number;
  gross: number;
  paymentAmount: number;
  /** Revenue recognised (credit balance on the revenue account), major units. */
  revenueRecognized: number;
  /** Outstanding receivable after settlement (gross − paid), major units. */
  receivableBalance: number;
  /** Cash received into the bank account, major units. */
  cashReceived: number;
};

/**
 * Post the invoice + customer receipt for one sale through the REAL pure GL
 * functions and return the journal, trial balance, and the financial summary the
 * oracles assert on. Pure and deterministic — the shared spine every archetype
 * flow bills through. (The operational lifecycle — when a job/subscription/order
 * reaches these states — is tracked by the archetype flow, not here.)
 */
export function runBillingCycle(input: BillingInput): BillingResult {
  const subtotal = Math.max(input.subtotal, 0);
  const taxAmount = Math.max(input.taxAmount ?? 0, 0);
  const gross = subtotal + taxAmount;
  const paymentAmount = input.paymentAmount ?? gross;

  const journal: JournalLineInput[] = [
    // SD → FI billing document: Dr AR (gross) / Cr Revenue (subtotal) / Cr Tax.
    ...buildInvoicePostingLines(
      { subtotal, taxAmount, customerAccountId: input.customerAccountId },
      {
        revenueAccountId: SIM_ACCOUNTS.revenue.accountId,
        receivablesAccountId: SIM_ACCOUNTS.receivables.accountId,
        taxPayableAccountId: SIM_ACCOUNTS.taxPayable.accountId,
      },
    ),
    // Customer receipt: Dr Bank / Cr AR — the settlement half of the cash cycle.
    ...buildPaymentPostingLines(
      { direction: "inbound", amount: paymentAmount, customerAccountId: input.customerAccountId },
      {
        bankAccountId: SIM_ACCOUNTS.bank.accountId,
        receivablesAccountId: SIM_ACCOUNTS.receivables.accountId,
      },
    ),
  ];

  const trialBalance = computeTrialBalance(SIM_ACCOUNT_LIST, journal);
  const balanceOf = (accountId: string) =>
    trialBalance.rows.find((r) => r.accountId === accountId)?.balance ?? 0;

  return {
    journal,
    trialBalance,
    subtotal,
    taxAmount,
    gross,
    paymentAmount,
    revenueRecognized: balanceOf(SIM_ACCOUNTS.revenue.accountId),
    receivableBalance: balanceOf(SIM_ACCOUNTS.receivables.accountId),
    cashReceived: balanceOf(SIM_ACCOUNTS.bank.accountId),
  };
}

/**
 * The minimal shape every archetype flow result must expose for the shared
 * financial + lifecycle oracles. Both P1's FieldServiceFlowResult and P2's
 * ArchetypeFlowResult structurally satisfy it, so one oracle set scores them all.
 */
export type FinancialFlowShape = BillingResult & {
  /** True once the job/subscription/order reached a service-delivered state
   *  before it was invoiced (the guard behind the no-phantom-billing oracle). */
  workCompletedBeforeInvoice: boolean;
  /** The terminal lifecycle status the flow ended in ("paid" on the happy path). */
  finalStatus: string;
};
