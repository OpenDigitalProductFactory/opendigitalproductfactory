// lib/finance/ledger.ts — General Ledger, the management single-source-of-truth (AGT-900)
//
// The double-entry posting layer that the finance sub-ledgers (Invoice, Bill,
// Payment, ExpenseClaim, FixedAsset depreciation) post to. It is DPF's analog of
// the S/4HANA Universal Journal (ACDOCA): one balanced line-item record of every
// financial movement, from which a trial balance — and therefore a real balance
// sheet and income statement — can be derived, rather than recomputed ad hoc from
// scattered documents.
//
// This module holds the *invariants* (the accounting rules) as pure functions so
// they can be unit-tested without a database, and are reused identically by the
// API/persistence layer and by any coworker that proposes a posting. The DB models
// LedgerAccount / JournalEntry / JournalLine live in packages/db/prisma/schema.prisma.

// ─── String-enum registries (canonical, mirror the schema String columns) ─────

/** LedgerAccount.type — the five fundamental account classes. */
export const LEDGER_ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
] as const;
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

/** LedgerAccount.normalBalance — the side on which a balance for this class grows. */
export const NORMAL_BALANCES = ["debit", "credit"] as const;
export type NormalBalance = (typeof NORMAL_BALANCES)[number];

/** JournalEntry.status. A draft is mutable; a posted entry is immutable and is
 * corrected only by a reversing entry; reversed marks an entry undone by its pair. */
export const JOURNAL_ENTRY_STATUSES = ["draft", "posted", "reversed"] as const;
export type JournalEntryStatus = (typeof JOURNAL_ENTRY_STATUSES)[number];

/** JournalEntry.source — the flow that originated the entry. */
export const JOURNAL_SOURCES = [
  "manual",
  "invoice",
  "bill",
  "payment",
  "expense",
  "depreciation",
  "opening-balance",
  "fx-revaluation",
] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

// ─── Account classification ───────────────────────────────────────────────────

/**
 * The normal balance for an account class. Assets and expenses increase on the
 * debit side; liabilities, equity and revenue increase on the credit side. Stored
 * on LedgerAccount so reports can orient a net balance without re-deriving it, but
 * always resolvable from `type` alone via this function (the single source).
 */
export function normalBalanceForType(type: LedgerAccountType): NormalBalance {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

export function isLedgerAccountType(value: string): value is LedgerAccountType {
  return (LEDGER_ACCOUNT_TYPES as readonly string[]).includes(value);
}

// ─── Money handling ───────────────────────────────────────────────────────────
//
// Journal amounts are stored as Decimal in Postgres. In this pure layer we accept
// plain numbers and compare in integer minor units (cents/pence) so that ordinary
// floating-point error (0.1 + 0.2) can never make a balanced entry look unbalanced.

/** Round to integer minor units (2dp) to sidestep binary-float drift. */
export function toMinorUnits(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100);
}

export type JournalLineInput = {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string;
  customerAccountId?: string | null;
  contactId?: string | null;
};

export type JournalValidationResult = {
  ok: boolean;
  /** Sum of debits and credits in major units, for display. */
  totalDebit: number;
  totalCredit: number;
  errors: string[];
};

/**
 * Validate the invariants every journal entry must satisfy before it can post:
 *  1. at least two lines (a posting always has a source and a destination);
 *  2. every amount is non-negative and finite;
 *  3. each line is single-sided — exactly one of debit/credit is non-zero;
 *  4. total debits equal total credits (the double-entry balance rule).
 *
 * Pure and side-effect-free: returns the verdict plus every violation, so callers
 * can surface all problems at once rather than failing on the first.
 */
export function validateJournalEntry(lines: JournalLineInput[]): JournalValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(lines) || lines.length < 2) {
    errors.push("A journal entry needs at least two lines (one debit, one credit).");
  }

  let debitMinor = 0;
  let creditMinor = 0;

  lines?.forEach((line, i) => {
    const debit = line.debit ?? 0;
    const credit = line.credit ?? 0;
    const label = `line ${i + 1}`;

    if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
      errors.push(`${label}: debit and credit must be finite numbers.`);
      return;
    }
    if (debit < 0 || credit < 0) {
      errors.push(`${label}: amounts must be non-negative (use the opposite column, not a negative).`);
    }
    if (debit > 0 && credit > 0) {
      errors.push(`${label}: a line is single-sided — set either debit or credit, not both.`);
    }
    if (debit === 0 && credit === 0) {
      errors.push(`${label}: a line must carry a non-zero debit or credit.`);
    }
    if (!line.accountId) {
      errors.push(`${label}: a ledger account is required.`);
    }

    debitMinor += toMinorUnits(Math.max(debit, 0));
    creditMinor += toMinorUnits(Math.max(credit, 0));
  });

  if (debitMinor !== creditMinor) {
    errors.push(
      `Entry is unbalanced: debits ${(debitMinor / 100).toFixed(2)} ≠ credits ${(creditMinor / 100).toFixed(2)}.`,
    );
  }

  return {
    ok: errors.length === 0,
    totalDebit: debitMinor / 100,
    totalCredit: creditMinor / 100,
    errors,
  };
}

// ─── Trial balance ──────────────────────────────────────────────────────────

export type TrialBalanceAccount = {
  accountId: string;
  code: string;
  name: string;
  type: LedgerAccountType;
};

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  debitTotal: number;
  creditTotal: number;
  /** Net balance, oriented to the account's normal side (always ≥ 0 when the
   * account carries its natural balance; negative signals an unusual balance). */
  balance: number;
  normalBalance: NormalBalance;
};

export type TrialBalance = {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  /** True when total debits equal total credits — the ledger is internally consistent. */
  balanced: boolean;
};

/**
 * Aggregate posted journal lines into a trial balance: one row per account with
 * its debit and credit totals and a net balance oriented to the account's normal
 * side. Only lines belonging to `accounts` are counted. The whole ledger balances
 * iff total debits equal total credits — surfaced as `balanced`.
 */
export function computeTrialBalance(
  accounts: TrialBalanceAccount[],
  lines: Array<{ accountId: string; debit?: number; credit?: number }>,
): TrialBalance {
  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const acc of accounts) byAccount.set(acc.accountId, { debit: 0, credit: 0 });

  for (const line of lines) {
    const bucket = byAccount.get(line.accountId);
    if (!bucket) continue; // line references an account outside the requested set
    bucket.debit += toMinorUnits(line.debit ?? 0);
    bucket.credit += toMinorUnits(line.credit ?? 0);
  }

  let totalDebitMinor = 0;
  let totalCreditMinor = 0;
  const rows: TrialBalanceRow[] = accounts.map((acc) => {
    const bucket = byAccount.get(acc.accountId) ?? { debit: 0, credit: 0 };
    totalDebitMinor += bucket.debit;
    totalCreditMinor += bucket.credit;
    const normal = normalBalanceForType(acc.type);
    const netMinor =
      normal === "debit" ? bucket.debit - bucket.credit : bucket.credit - bucket.debit;
    return {
      accountId: acc.accountId,
      code: acc.code,
      name: acc.name,
      type: acc.type,
      debitTotal: bucket.debit / 100,
      creditTotal: bucket.credit / 100,
      balance: netMinor / 100,
      normalBalance: normal,
    };
  });

  return {
    rows,
    totalDebit: totalDebitMinor / 100,
    totalCredit: totalCreditMinor / 100,
    balanced: totalDebitMinor === totalCreditMinor,
  };
}

// ─── Period bucketing ────────────────────────────────────────────────────────

/** The "YYYY-MM" fiscal-period bucket a date falls in — JournalEntry.periodKey,
 * the grain the period-close workflow (apps/web/lib/finance/period-summary.ts)
 * operates on. */
export function periodKeyOf(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Build reversing lines for a journal entry (storno / reversal posting):
 * Swaps debits and credits for each line so the reversing entry exactly cancels out the original.
 * Guarantees that if the original entry passed validateJournalEntry, the reversal entry balances identically.
 */
export function buildReversalPostingLines(lines: JournalLineInput[]): JournalLineInput[] {
  if (!Array.isArray(lines)) return [];
  return lines.map((l) => ({
    accountId: l.accountId,
    debit: l.credit ? Math.max(l.credit, 0) : undefined,
    credit: l.debit ? Math.max(l.debit, 0) : undefined,
    description: l.description ? `Reversal: ${l.description}` : "Reversal",
    customerAccountId: l.customerAccountId ?? null,
    contactId: l.contactId ?? null,
  }));
}

/**
 * Check if a fiscal period key ("YYYY-MM") is locked against new postings.
 */
export function isPeriodLocked(
  periodKey: string,
  lockedPeriodKeys: Iterable<string>,
): boolean {
  const set = lockedPeriodKeys instanceof Set ? lockedPeriodKeys : new Set(lockedPeriodKeys);
  return set.has(periodKey);
}

/**
 * Validate period lock invariant before posting to the ledger.
 */
export function validatePostingPeriod(
  entryDate: Date,
  lockedPeriodKeys: Iterable<string>,
): { ok: boolean; periodKey: string; error?: string } {
  const periodKey = periodKeyOf(entryDate);
  if (isPeriodLocked(periodKey, lockedPeriodKeys)) {
    return {
      ok: false,
      periodKey,
      error: `Fiscal period ${periodKey} is locked for financial close; new postings are rejected.`,
    };
  }
  return { ok: true, periodKey };
}

// ─── Sub-ledger → GL posting builders ────────────────────────────────────────
//
// These translate a sub-ledger document into the balanced set of journal lines
// that records it in the GL. They are the seam that makes the sub-ledgers post to
// the ledger instead of floating beside it. Each returns lines that
// validateJournalEntry() accepts by construction.

export type AccountResolver = {
  /** The account documents post revenue to (Sales / income). */
  revenueAccountId: string;
  /** The trade-receivables control account (what customers owe). */
  receivablesAccountId: string;
  /** The output-VAT / sales-tax liability account, if tax applies. */
  taxPayableAccountId?: string;
};

export type InvoicePostingSource = {
  subtotal: number; // net of tax, before the receivable
  taxAmount: number;
  customerAccountId?: string | null;
  contactId?: string | null;
};

/**
 * Build the journal for issuing a customer invoice (SAP SD → FI billing document):
 *   Dr  Accounts Receivable   subtotal + tax   (the customer now owes the gross)
 *     Cr  Revenue                     subtotal
 *     Cr  Tax Payable                 tax       (only when tax applies)
 *
 * The receivable equals gross so the entry balances by construction; the tax line
 * is omitted when taxAmount is zero and no tax account is configured.
 */
export function buildInvoicePostingLines(
  invoice: InvoicePostingSource,
  accounts: AccountResolver,
): JournalLineInput[] {
  const subtotal = Math.max(invoice.subtotal, 0);
  const tax = Math.max(invoice.taxAmount, 0);
  const gross = subtotal + tax;

  const lines: JournalLineInput[] = [
    {
      accountId: accounts.receivablesAccountId,
      debit: gross,
      description: "Accounts receivable",
      customerAccountId: invoice.customerAccountId ?? null,
      contactId: invoice.contactId ?? null,
    },
    {
      accountId: accounts.revenueAccountId,
      credit: subtotal,
      description: "Revenue",
      customerAccountId: invoice.customerAccountId ?? null,
    },
  ];

  if (tax > 0) {
    if (!accounts.taxPayableAccountId) {
      throw new Error(
        "Invoice carries tax but no taxPayableAccountId was resolved for the posting.",
      );
    }
    lines.push({
      accountId: accounts.taxPayableAccountId,
      credit: tax,
      description: "Output tax payable",
    });
  }

  return lines;
}

// ─── Payment settlement posting ──────────────────────────────────────────────

export type PaymentPostingResolver = {
  /** The cash/bank account the money moves through. */
  bankAccountId: string;
  /** Trade receivables — cleared when a customer pays (inbound). */
  receivablesAccountId?: string;
  /** Trade payables — cleared when we pay a supplier (outbound). */
  payablesAccountId?: string;
};

export type PaymentPostingSource = {
  /** "inbound" = customer receipt, "outbound" = supplier payment (PAYMENT_DIRECTIONS). */
  direction: "inbound" | "outbound";
  amount: number;
  customerAccountId?: string | null;
  contactId?: string | null;
};

/**
 * Build the journal for a recorded payment — the settlement half of the cash
 * cycle, so a payment lands on the same ledger the invoice/bill posted to:
 *
 *   inbound  (customer receipt):  Dr Bank  /  Cr Accounts Receivable
 *   outbound (supplier payment):  Dr Accounts Payable  /  Cr Bank
 *
 * Balances by construction (one debit, one credit, equal amount). Throws if the
 * control account the direction needs (receivables for inbound, payables for
 * outbound) was not resolved, so a payment never posts to the wrong account.
 */
export function buildPaymentPostingLines(
  payment: PaymentPostingSource,
  accounts: PaymentPostingResolver,
): JournalLineInput[] {
  const amount = Math.max(payment.amount, 0);

  if (payment.direction === "inbound") {
    if (!accounts.receivablesAccountId) {
      throw new Error(
        "Inbound payment needs a receivablesAccountId to clear, but none was resolved.",
      );
    }
    return [
      {
        accountId: accounts.bankAccountId,
        debit: amount,
        description: "Bank — customer receipt",
        customerAccountId: payment.customerAccountId ?? null,
        contactId: payment.contactId ?? null,
      },
      {
        accountId: accounts.receivablesAccountId,
        credit: amount,
        description: "Accounts receivable settled",
        customerAccountId: payment.customerAccountId ?? null,
      },
    ];
  }

  if (!accounts.payablesAccountId) {
    throw new Error(
      "Outbound payment needs a payablesAccountId to clear, but none was resolved.",
    );
  }
  return [
    {
      accountId: accounts.payablesAccountId,
      debit: amount,
      description: "Accounts payable settled",
      contactId: payment.contactId ?? null,
    },
    {
      accountId: accounts.bankAccountId,
      credit: amount,
      description: "Bank — supplier payment",
    },
  ];
}

// ─── Supplier-bill posting (AP recognition) ──────────────────────────────────

export type BillPostingResolver = {
  /** Trade payables control — what we now owe the supplier. */
  payablesAccountId: string;
  /** The expense account the bill's cost lands in. */
  expenseAccountId: string;
  /** Recoverable input VAT/GST (an asset), if tax applies and an account exists. */
  inputTaxAccountId?: string;
};

export type BillPostingSource = {
  subtotal: number; // net of tax
  taxAmount: number;
  contactId?: string | null;
};

/**
 * Build the journal for finalising a supplier bill (SAP MM → FI vendor invoice):
 *   Dr  Expense              net
 *   Dr  Input Tax Recoverable tax   (only when tax applies AND an input-tax account exists)
 *     Cr  Accounts Payable        net + tax   (the gross we now owe)
 *
 * Balances by construction. When no input-tax account is resolved the tax is folded
 * into the expense (tax-inclusive cost) so the entry still balances — the common
 * case for a non-VAT-registered SMB.
 */
export function buildBillPostingLines(
  bill: BillPostingSource,
  accounts: BillPostingResolver,
): JournalLineInput[] {
  const net = Math.max(bill.subtotal, 0);
  const tax = Math.max(bill.taxAmount, 0);
  const gross = net + tax;
  const splitTax = tax > 0 && !!accounts.inputTaxAccountId;

  const lines: JournalLineInput[] = [
    {
      accountId: accounts.expenseAccountId,
      debit: splitTax ? net : gross,
      description: "Operating expense",
      contactId: bill.contactId ?? null,
    },
  ];

  if (splitTax) {
    lines.push({
      accountId: accounts.inputTaxAccountId!,
      debit: tax,
      description: "Input tax recoverable",
    });
  }

  lines.push({
    accountId: accounts.payablesAccountId,
    credit: gross,
    description: "Accounts payable",
  });

  return lines;
}

// ─── Financial statements (derived from the trial balance) ───────────────────

export type IncomeStatement = {
  revenue: number;
  expenses: number;
  netIncome: number; // revenue − expenses
};

export type BalanceSheet = {
  assets: number;
  liabilities: number;
  equity: number;
  /** Current-period result, not yet closed to retained earnings. */
  netIncome: number;
  /** Assets = Liabilities + Equity + net income (the accounting equation holds). */
  balanced: boolean;
};

export type FinancialStatements = {
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
};

/**
 * Roll a trial balance up into an income statement and a balance sheet by account
 * class. Each row's `balance` is already oriented to its normal side, so summing by
 * type gives the natural positive totals. A ledger whose trial balance balances
 * satisfies the accounting equation Assets = Liabilities + Equity + (Revenue −
 * Expenses); `balanced` re-checks that in integer minor units so display rounding
 * can never make a consistent book look inconsistent.
 */
export function deriveFinancialStatements(tb: TrialBalance): FinancialStatements {
  let assets = 0;
  let liabilities = 0;
  let equity = 0;
  let revenue = 0;
  let expenses = 0;

  for (const row of tb.rows) {
    switch (row.type) {
      case "asset":
        assets += row.balance;
        break;
      case "liability":
        liabilities += row.balance;
        break;
      case "equity":
        equity += row.balance;
        break;
      case "revenue":
        revenue += row.balance;
        break;
      case "expense":
        expenses += row.balance;
        break;
    }
  }

  const netIncome = (toMinorUnits(revenue) - toMinorUnits(expenses)) / 100;
  const balanced =
    toMinorUnits(assets) === toMinorUnits(liabilities) + toMinorUnits(equity) + toMinorUnits(netIncome);

  return {
    incomeStatement: { revenue, expenses, netIncome },
    balanceSheet: { assets, liabilities, equity, netIncome, balanced },
  };
}

// ─── Fixed-asset depreciation ────────────────────────────────────────────────

export type DepreciationMethod = "straight_line" | "reducing_balance";

export type DepreciableAsset = {
  purchaseCost: number;
  residualValue: number;
  usefulLifeMonths: number;
  depreciationMethod: DepreciationMethod;
  /** Depreciation already booked against this asset. */
  accumulatedDepreciation: number;
};

/**
 * The depreciation charge for ONE period for an asset, given what has already been
 * booked. Never takes accumulated depreciation past the depreciable base
 * (cost − residual), so an asset stops at its residual value; returns 0 for a
 * fully-depreciated or zero-life asset.
 *   straight_line:    (cost − residual) / usefulLifeMonths, flat each period.
 *   reducing_balance: bookValue × (2 / usefulLifeMonths) — double-declining —
 *                     capped so book value never dips below the residual.
 */
export function computeMonthlyDepreciation(asset: DepreciableAsset): number {
  const cost = Math.max(asset.purchaseCost, 0);
  const residual = Math.max(asset.residualValue, 0);
  const life = asset.usefulLifeMonths;
  const accumulated = Math.max(asset.accumulatedDepreciation, 0);

  const depreciableBase = Math.max(cost - residual, 0);
  const remaining = Math.max(depreciableBase - accumulated, 0);
  if (life <= 0 || remaining <= 0) return 0;

  const charge =
    asset.depreciationMethod === "reducing_balance"
      ? (cost - accumulated) * (2 / life) // double-declining on book value
      : depreciableBase / life; // straight line

  const rounded = Math.round(Math.max(charge, 0) * 100) / 100;
  return Math.min(rounded, remaining); // never over-depreciate past the residual
}

export type DepreciationPostingResolver = {
  depreciationExpenseAccountId: string;
  accumulatedDepreciationAccountId: string;
};

/**
 * Build the journal for a period's depreciation charge:
 *   Dr Depreciation Expense (P&L) / Cr Accumulated Depreciation (contra-asset).
 * Balances by construction; `amount` is the total charge for the period.
 */
export function buildDepreciationPostingLines(
  amount: number,
  accounts: DepreciationPostingResolver,
): JournalLineInput[] {
  const charge = Math.max(amount, 0);
  return [
    { accountId: accounts.depreciationExpenseAccountId, debit: charge, description: "Depreciation" },
    {
      accountId: accounts.accumulatedDepreciationAccountId,
      credit: charge,
      description: "Accumulated depreciation",
    },
  ];
}
