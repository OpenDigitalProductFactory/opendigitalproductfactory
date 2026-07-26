// lib/finance/ledger-service.ts — persistence + auto-posting for the General Ledger (AGT-900)
//
// The DB seam that makes the ledger *automatic*: the chart of accounts is seeded
// from the org's financial profile at setup, and finalising a sub-ledger document
// posts a balanced journal entry with no manual step. The accounting rules
// (balancing, account determination) live in the pure, unit-tested siblings
// ./ledger and ./chart-of-accounts; this file only reads/writes Prisma around them.
//
// Single-org install convention: the operating organization is resolved via
// prisma.organization.findFirst() (the same pattern applyFinancialProfile uses).

import { prisma } from "@dpf/db";
import { getFinancialProfile } from "@dpf/finance-templates";
import {
  buildOrgChartOfAccounts,
  resolvePostingAccounts,
  type DeterminableAccount,
} from "./chart-of-accounts";
import {
  buildInvoicePostingLines,
  buildPaymentPostingLines,
  buildBillPostingLines,
  buildDepreciationPostingLines,
  buildReversalPostingLines,
  validateJournalEntry,
  computeTrialBalance,
  deriveFinancialStatements,
  periodKeyOf,
  type LedgerAccountType,
  type TrialBalanceAccount,
  type TrialBalance,
  type FinancialStatements,
} from "./ledger";

// ─── Chart-of-accounts seeding ───────────────────────────────────────────────

export type SeedChartResult = { seeded: number; total: number; profileSlug: string | null };

/**
 * Seed (idempotently) the org's chart of accounts from its applied financial
 * profile. Called at setup from applyFinancialProfile, and safe to re-run: each
 * account upserts on the unique (organizationId, code), so existing accounts and
 * any user edits to their names are left untouched while missing spine accounts
 * are filled in.
 */
export async function seedChartOfAccounts(organizationId: string): Promise<SeedChartResult> {
  const settings = await prisma.orgSettings.findFirst({ select: { appliedProfileSlug: true } });
  const profile = settings?.appliedProfileSlug
    ? getFinancialProfile(settings.appliedProfileSlug)
    : null;

  // With no profile we still lay down the base control spine so the ledger works.
  const chart = buildOrgChartOfAccounts(profile ?? { chartOfAccountsSeed: [] });

  let seeded = 0;
  for (const account of chart) {
    const existing = await prisma.ledgerAccount.findUnique({
      where: { organizationId_code: { organizationId, code: account.code } },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.ledgerAccount.create({
      data: {
        organizationId,
        code: account.code,
        name: account.name,
        type: account.type,
        normalBalance: account.normalBalance,
        isControl: account.isControl ?? false,
      },
    });
    seeded += 1;
  }

  return { seeded, total: chart.length, profileSlug: settings?.appliedProfileSlug ?? null };
}

// ─── Invoice → GL auto-posting ───────────────────────────────────────────────

export type PostInvoiceResult =
  | { posted: true; journalEntryId: string; entryRef: string }
  | { posted: false; reason: "already-posted" | "no-organization" | "unresolved-accounts"; detail?: string };

/**
 * Post an issued customer invoice to the ledger:
 *   Dr Accounts Receivable (gross) / Cr Revenue (net) / Cr Tax Payable (tax).
 *
 * Idempotent — a second call for the same invoice is a no-op (one journal per
 * source document, keyed on sourceType+sourceId). Account determination is
 * automatic via resolvePostingAccounts; if a required account cannot be resolved
 * the invoice is *not* posted and the missing roles are reported rather than
 * guessed, so the books never silently misstate.
 */
export async function postInvoiceIssued(invoiceId: string): Promise<PostInvoiceResult> {
  const existing = await prisma.journalEntry.findFirst({
    where: { sourceType: "Invoice", sourceId: invoiceId },
    select: { id: true, entryRef: true },
  });
  if (existing) {
    return { posted: false, reason: "already-posted", detail: existing.entryRef };
  }

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return { posted: false, reason: "no-organization" };

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      invoiceRef: true,
      accountId: true,
      contactId: true,
      currency: true,
      issueDate: true,
      subtotal: true,
      taxAmount: true,
    },
  });

  const accounts = await prisma.ledgerAccount.findMany({
    where: { organizationId: org.id, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });

  const determinable: DeterminableAccount[] = accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type as LedgerAccountType,
  }));
  const { resolved } = resolvePostingAccounts(determinable);

  const tax = Number(invoice.taxAmount);
  const needed: string[] = ["receivables", "salesRevenue"];
  if (tax > 0) needed.push("taxPayable");
  const missing = needed.filter((role) => !resolved[role as keyof typeof resolved]);
  if (missing.length > 0) {
    return { posted: false, reason: "unresolved-accounts", detail: missing.join(", ") };
  }

  const lines = buildInvoicePostingLines(
    {
      subtotal: Number(invoice.subtotal),
      taxAmount: tax,
      customerAccountId: invoice.accountId,
      contactId: invoice.contactId,
    },
    {
      receivablesAccountId: resolved.receivables!.id!,
      revenueAccountId: resolved.salesRevenue!.id!,
      taxPayableAccountId: resolved.taxPayable?.id,
    },
  );

  const check = validateJournalEntry(lines);
  if (!check.ok) {
    // A balancing failure here is a programming error, not user input — surface loudly.
    throw new Error(`Invoice ${invoice.invoiceRef} posting is unbalanced: ${check.errors.join("; ")}`);
  }

  const entry = await prisma.journalEntry.create({
    data: {
      organizationId: org.id,
      entryRef: `JE-${invoice.invoiceRef}`,
      entryDate: invoice.issueDate,
      periodKey: periodKeyOf(invoice.issueDate),
      status: "posted",
      source: "invoice",
      sourceType: "Invoice",
      sourceId: invoiceId,
      currency: invoice.currency,
      postedAt: new Date(),
      memo: `Customer invoice ${invoice.invoiceRef}`,
      lines: {
        create: lines.map((l, i) => ({
          accountId: l.accountId,
          debit: l.debit ?? 0,
          credit: l.credit ?? 0,
          currency: invoice.currency,
          description: l.description,
          customerAccountId: l.customerAccountId ?? null,
          contactId: l.contactId ?? null,
          sortOrder: i,
        })),
      },
    },
    select: { id: true, entryRef: true },
  });

  return { posted: true, journalEntryId: entry.id, entryRef: entry.entryRef };
}

// ─── Payment → GL auto-posting ───────────────────────────────────────────────

export type PostPaymentResult =
  | { posted: true; journalEntryId: string; entryRef: string }
  | { posted: false; reason: "already-posted" | "no-organization" | "unresolved-accounts"; detail?: string };

/**
 * Post a recorded payment to the ledger — the settlement half of the cash cycle,
 * so a receipt/payment lands on the same ledger the invoice/bill posted to:
 *   inbound  (customer receipt):  Dr Bank / Cr Accounts Receivable
 *   outbound (supplier payment):  Dr Accounts Payable / Cr Bank
 *
 * Idempotent (one journal per payment). Automatic account determination; if a
 * required account can't be resolved the payment is NOT posted and the missing
 * roles are reported rather than guessed.
 */
export async function postPaymentRecorded(paymentId: string): Promise<PostPaymentResult> {
  const existing = await prisma.journalEntry.findFirst({
    where: { sourceType: "Payment", sourceId: paymentId },
    select: { id: true, entryRef: true },
  });
  if (existing) return { posted: false, reason: "already-posted", detail: existing.entryRef };

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return { posted: false, reason: "no-organization" };

  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: {
      paymentRef: true,
      direction: true,
      amount: true,
      currency: true,
      receivedAt: true,
      allocations: {
        where: { invoiceId: { not: null } },
        take: 1,
        select: { invoice: { select: { accountId: true, contactId: true } } },
      },
    },
  });

  const direction = payment.direction === "outbound" ? "outbound" : "inbound";
  const linkedInvoice = payment.allocations[0]?.invoice ?? null;

  const accounts = await prisma.ledgerAccount.findMany({
    where: { organizationId: org.id, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });
  const { resolved } = resolvePostingAccounts(
    accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type as LedgerAccountType })),
  );

  const missing: string[] = [];
  if (!resolved.bank) missing.push("bank");
  if (direction === "inbound" && !resolved.receivables) missing.push("receivables");
  if (direction === "outbound" && !resolved.payables) missing.push("payables");
  if (missing.length > 0) {
    return { posted: false, reason: "unresolved-accounts", detail: missing.join(", ") };
  }

  const lines = buildPaymentPostingLines(
    {
      direction,
      amount: Number(payment.amount),
      customerAccountId: linkedInvoice?.accountId ?? null,
      contactId: linkedInvoice?.contactId ?? null,
    },
    {
      bankAccountId: resolved.bank!.id!,
      receivablesAccountId: resolved.receivables?.id,
      payablesAccountId: resolved.payables?.id,
    },
  );

  const check = validateJournalEntry(lines);
  if (!check.ok) {
    throw new Error(`Payment ${payment.paymentRef} posting is unbalanced: ${check.errors.join("; ")}`);
  }

  const when = payment.receivedAt ?? new Date();
  const entry = await prisma.journalEntry.create({
    data: {
      organizationId: org.id,
      entryRef: `JE-${payment.paymentRef}`,
      entryDate: when,
      periodKey: periodKeyOf(when),
      status: "posted",
      source: "payment",
      sourceType: "Payment",
      sourceId: paymentId,
      currency: payment.currency,
      postedAt: new Date(),
      memo: `Payment ${payment.paymentRef}`,
      lines: {
        create: lines.map((l, i) => ({
          accountId: l.accountId,
          debit: l.debit ?? 0,
          credit: l.credit ?? 0,
          currency: payment.currency,
          description: l.description,
          customerAccountId: l.customerAccountId ?? null,
          contactId: l.contactId ?? null,
          sortOrder: i,
        })),
      },
    },
    select: { id: true, entryRef: true },
  });

  return { posted: true, journalEntryId: entry.id, entryRef: entry.entryRef };
}

// ─── Bill → GL auto-posting (AP recognition) ─────────────────────────────────

export type PostBillResult =
  | { posted: true; journalEntryId: string; entryRef: string }
  | { posted: false; reason: "already-posted" | "no-organization" | "unresolved-accounts"; detail?: string };

/**
 * Post a finalised (approved) supplier bill to the ledger:
 *   Dr Expense (net) [+ Dr Input Tax (tax)] / Cr Accounts Payable (gross).
 *
 * Idempotent (one journal per bill). Automatic account determination via
 * resolvePostingAccounts; if the expense or payables account can't be resolved the
 * bill is not posted and the missing roles are reported rather than guessed.
 */
export async function postBillFinalized(billId: string): Promise<PostBillResult> {
  const existing = await prisma.journalEntry.findFirst({
    where: { sourceType: "Bill", sourceId: billId },
    select: { id: true, entryRef: true },
  });
  if (existing) return { posted: false, reason: "already-posted", detail: existing.entryRef };

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return { posted: false, reason: "no-organization" };

  const bill = await prisma.bill.findUniqueOrThrow({
    where: { id: billId },
    select: { billRef: true, currency: true, issueDate: true, subtotal: true, taxAmount: true },
  });

  const accounts = await prisma.ledgerAccount.findMany({
    where: { organizationId: org.id, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });
  const determinable: DeterminableAccount[] = accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type as LedgerAccountType,
  }));
  const { resolved } = resolvePostingAccounts(determinable);

  const missing: string[] = [];
  if (!resolved.payables) missing.push("payables");
  if (!resolved.operatingExpense) missing.push("operatingExpense");
  if (missing.length > 0) {
    return { posted: false, reason: "unresolved-accounts", detail: missing.join(", ") };
  }

  const lines = buildBillPostingLines(
    { subtotal: Number(bill.subtotal), taxAmount: Number(bill.taxAmount) },
    {
      payablesAccountId: resolved.payables!.id!,
      expenseAccountId: resolved.operatingExpense!.id!,
      inputTaxAccountId: resolved.inputTaxRecoverable?.id,
    },
  );

  const check = validateJournalEntry(lines);
  if (!check.ok) {
    throw new Error(`Bill ${bill.billRef} posting is unbalanced: ${check.errors.join("; ")}`);
  }

  const entry = await prisma.journalEntry.create({
    data: {
      organizationId: org.id,
      entryRef: `JE-${bill.billRef}`,
      entryDate: bill.issueDate,
      periodKey: periodKeyOf(bill.issueDate),
      status: "posted",
      source: "bill",
      sourceType: "Bill",
      sourceId: billId,
      currency: bill.currency,
      postedAt: new Date(),
      memo: `Supplier bill ${bill.billRef}`,
      lines: {
        create: lines.map((l, i) => ({
          accountId: l.accountId,
          debit: l.debit ?? 0,
          credit: l.credit ?? 0,
          currency: bill.currency,
          description: l.description,
          customerAccountId: l.customerAccountId ?? null,
          contactId: l.contactId ?? null,
          sortOrder: i,
        })),
      },
    },
    select: { id: true, entryRef: true },
  });

  return { posted: true, journalEntryId: entry.id, entryRef: entry.entryRef };
}

// ─── General-ledger report (read model) ──────────────────────────────────────

export type GeneralLedgerReport = {
  /** The period this report covers ("YYYY-MM"), or null for all-time. */
  periodKey: string | null;
  currency: string;
  trialBalance: TrialBalance;
  statements: FinancialStatements;
  /** True when the org has no posted journal entries yet (empty-state signal). */
  isEmpty: boolean;
};

/**
 * Build the general-ledger report — a trial balance and the balance sheet + income
 * statement derived from it — from posted journal lines. This is the *read* side of
 * the ledger: the books are derived from the one journal, never recomputed ad hoc
 * from sub-ledger documents. Pass a `periodKey` ("YYYY-MM") to scope to a fiscal
 * period, or omit for all-time.
 */
export async function getGeneralLedgerReport(periodKey?: string): Promise<GeneralLedgerReport> {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  const settings = await prisma.orgSettings.findFirst({ select: { baseCurrency: true } });
  const currency = settings?.baseCurrency ?? "GBP";

  const emptyReport: GeneralLedgerReport = {
    periodKey: periodKey ?? null,
    currency,
    trialBalance: { rows: [], totalDebit: 0, totalCredit: 0, balanced: true },
    statements: {
      incomeStatement: { revenue: 0, expenses: 0, netIncome: 0 },
      balanceSheet: { assets: 0, liabilities: 0, equity: 0, netIncome: 0, balanced: true },
    },
    isEmpty: true,
  };
  if (!org) return emptyReport;

  const accountRows = await prisma.ledgerAccount.findMany({
    where: { organizationId: org.id },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });

  const lineRows = await prisma.journalLine.findMany({
    where: {
      journalEntry: {
        organizationId: org.id,
        status: "posted",
        ...(periodKey ? { periodKey } : {}),
      },
    },
    select: { accountId: true, debit: true, credit: true },
  });

  const accounts: TrialBalanceAccount[] = accountRows.map((a) => ({
    accountId: a.id,
    code: a.code,
    name: a.name,
    type: a.type as LedgerAccountType,
  }));
  const lines = lineRows.map((l) => ({
    accountId: l.accountId,
    debit: Number(l.debit),
    credit: Number(l.credit),
  }));

  const trialBalance = computeTrialBalance(accounts, lines);
  const statements = deriveFinancialStatements(trialBalance);

  return {
    periodKey: periodKey ?? null,
    currency,
    trialBalance,
    statements,
    isEmpty: lineRows.length === 0,
  };
}

// ─── Fixed-asset depreciation → GL ───────────────────────────────────────────

export type PostDepreciationResult = {
  posted: boolean;
  periodKey: string;
  totalCharge: number;
  journalEntryId?: string;
  reason?: "already-posted" | "no-organization" | "unresolved-accounts" | "nothing-to-post";
  detail?: string;
};

/**
 * Post a period's total depreciation charge to the GL as one balanced journal:
 *   Dr Depreciation Expense / Cr Accumulated Depreciation.
 * Idempotent per period. Asset book-value updates are the caller's responsibility
 * (runMonthlyDepreciation); this records only the ledger side. Automatic account
 * determination — if the depreciation accounts can't be resolved nothing posts.
 */
export async function postDepreciationJournal(
  periodKey: string,
  totalCharge: number,
): Promise<PostDepreciationResult> {
  const charge = Math.round(Math.max(totalCharge, 0) * 100) / 100;
  const zero = { posted: false as const, periodKey, totalCharge: charge };
  if (charge <= 0) return { ...zero, reason: "nothing-to-post" };

  const existing = await prisma.journalEntry.findFirst({
    where: { sourceType: "Depreciation", sourceId: periodKey },
    select: { id: true },
  });
  if (existing) return { ...zero, reason: "already-posted", detail: existing.id };

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) return { ...zero, reason: "no-organization" };

  const settings = await prisma.orgSettings.findFirst({ select: { baseCurrency: true } });
  const currency = settings?.baseCurrency ?? "GBP";

  const accountRows = await prisma.ledgerAccount.findMany({
    where: { organizationId: org.id, isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, type: true },
  });
  const { resolved } = resolvePostingAccounts(
    accountRows.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type as LedgerAccountType })),
  );
  if (!resolved.depreciationExpense || !resolved.accumulatedDepreciation) {
    const missing = [
      resolved.depreciationExpense ? null : "depreciationExpense",
      resolved.accumulatedDepreciation ? null : "accumulatedDepreciation",
    ].filter(Boolean);
    return { ...zero, reason: "unresolved-accounts", detail: missing.join(", ") };
  }

  const lines = buildDepreciationPostingLines(charge, {
    depreciationExpenseAccountId: resolved.depreciationExpense.id!,
    accumulatedDepreciationAccountId: resolved.accumulatedDepreciation.id!,
  });
  const check = validateJournalEntry(lines);
  if (!check.ok) {
    throw new Error(`Depreciation ${periodKey} posting is unbalanced: ${check.errors.join("; ")}`);
  }

  const [year, month] = periodKey.split("-").map((n) => Number(n));
  const entryDate = new Date(Date.UTC(year, month, 0));
  const entry = await prisma.journalEntry.create({
    data: {
      organizationId: org.id,
      entryRef: `JE-DEP-${periodKey}`,
      entryDate,
      periodKey,
      status: "posted",
      source: "depreciation",
      sourceType: "Depreciation",
      sourceId: periodKey,
      currency,
      postedAt: new Date(),
      memo: `Depreciation ${periodKey}`,
      lines: {
        create: lines.map((l, i) => ({
          accountId: l.accountId,
          debit: l.debit ?? 0,
          credit: l.credit ?? 0,
          currency,
          description: l.description,
          sortOrder: i,
        })),
      },
    },
    select: { id: true },
  });
  return { posted: true, periodKey, totalCharge: charge, journalEntryId: entry.id };
}

// ─── Journal Entry Reversal / Correction ──────────────────────────────────────

export type ReverseJournalEntryResult =
  | { success: true; reversingEntryId: string; entryRef: string }
  | { success: false; reason: "not-found" | "not-posted" | "period-locked" | "unbalanced"; detail?: string };

/**
 * Reverse a posted journal entry (storno / accounting correction):
 *  1. Ensures the target entry is currently `posted`.
 *  2. Generates an exact reversing journal entry with swapped debits/credits.
 *  3. Marks the original entry status as `reversed`.
 *  4. Enforces period-lock rules to prevent posting reversals into closed periods.
 */
export async function reverseJournalEntry(
  journalEntryId: string,
  reason?: string,
): Promise<ReverseJournalEntryResult> {
  const original = await prisma.journalEntry.findUnique({
    where: { id: journalEntryId },
    include: { lines: true },
  });

  if (!original) {
    return { success: false, reason: "not-found" };
  }
  if (original.status !== "posted") {
    return { success: false, reason: "not-posted", detail: `Entry is in status '${original.status}'` };
  }

  // Check period lock
  const closedSummary = await prisma.periodSummary.findFirst({
    where: { organizationId: original.organizationId, periodKey: original.periodKey, isClosed: true },
  });
  if (closedSummary) {
    return {
      success: false,
      reason: "period-locked",
      detail: `Period ${original.periodKey} is closed and locked against modifications.`,
    };
  }

  const reversingLines = buildReversalPostingLines(
    original.lines.map((l) => ({
      accountId: l.accountId,
      debit: Number(l.debit),
      credit: Number(l.credit),
      description: l.description ?? undefined,
      customerAccountId: l.customerAccountId,
      contactId: l.contactId,
    })),
  );

  const check = validateJournalEntry(reversingLines);
  if (!check.ok) {
    return { success: false, reason: "unbalanced", detail: check.errors.join("; ") };
  }

  const reversalRef = `REV-${original.entryRef}`;
  const now = new Date();

  const [reversalEntry] = await prisma.$transaction([
    prisma.journalEntry.create({
      data: {
        organizationId: original.organizationId,
        entryRef: reversalRef,
        entryDate: now,
        periodKey: periodKeyOf(now),
        status: "posted",
        source: "manual",
        sourceType: "JournalEntry",
        sourceId: original.id,
        currency: original.currency,
        postedAt: now,
        memo: reason ? `Reversal of ${original.entryRef}: ${reason}` : `Reversal of ${original.entryRef}`,
        lines: {
          create: reversingLines.map((l, i) => ({
            accountId: l.accountId,
            debit: l.debit ?? 0,
            credit: l.credit ?? 0,
            currency: original.currency,
            description: l.description,
            customerAccountId: l.customerAccountId ?? null,
            contactId: l.contactId ?? null,
            sortOrder: i,
          })),
        },
      },
      select: { id: true, entryRef: true },
    }),
    prisma.journalEntry.update({
      where: { id: original.id },
      data: { status: "reversed" },
    }),
  ]);

  return { success: true, reversingEntryId: reversalEntry.id, entryRef: reversalEntry.entryRef };
}
