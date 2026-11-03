import {
  computeTrialBalance, deriveFinancialStatements, isLedgerAccountType, toMinorUnits,
  type IncomeStatement, type TrialBalance, type LedgerAccountType,
} from "./ledger";

// Limit-plus-one reads must refuse truncation, never return partial totals.
export const LEDGER_PERIOD_LIMITS = { accounts: 1000, entries: 2000, lines: 10000 } as const;
export interface LedgerPeriodAccount {
  id: string; organizationId: string; code: string; name: string; type: string; currency: string;
}
export interface LedgerPeriodLine { accountId: string; debit: string; credit: string; currency: string }
export interface LedgerPeriodEntry {
  id: string; organizationId: string; periodKey: string; status: string; currency: string;
  sourceType: string | null; sourceId: string | null; reversalOfId: string | null;
  lineCount: number; lines: readonly LedgerPeriodLine[];
}
export interface LedgerPeriodSource {
  organizationId: string; periodKey: string | null; checkedAt: Date;
  accounts: readonly LedgerPeriodAccount[]; entries: readonly LedgerPeriodEntry[];
  /** Cross-period counterpart evidence; these rows never contribute to this period. */
  linkedEntries: readonly LedgerPeriodEntry[]; truncated: boolean;
}
interface PeriodEvidence { organizationId: string; periodKey: string | null; checkedAt: Date }
export type ScopedLedgerPeriodReport = PeriodEvidence & (
  | { availability: "unavailable"; currency: null; reason: string }
  | { availability: "available"; currency: string; incomeStatement: IncomeStatement;
      trialBalance: TrialBalance; sourceRows: { accounts: number; entries: number; lines: number } }
);

export function isLedgerMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && !value.startsWith("0000");
}

/** Match the existing JournalEntry.periodKey UTC convention, independently of storefront timezone. */
export function ledgerMonthWindow(at: Date) {
  const periodKey = at.toISOString().slice(0, 7);
  const start = new Date(`${periodKey}-01T00:00:00.000Z`);
  const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
  return { periodKey, start, end, timezone: "UTC" };
}

function minorAmount(value: string): number | null {
  if (typeof value !== "string" || value.length > 40 || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole = "", fraction = ""] = value.split(".");
  const significantFraction = fraction.replace(/0+$/, "");
  if (significantFraction.length > 2) return null;
  const integer = BigInt(whole) * 100n + BigInt(significantFraction.padEnd(2, "0"));
  if (integer > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const minor = Number(integer);
  return toMinorUnits(minor / 100) === minor ? minor : null;
}

export function isSupportedLedgerCurrency(currency: string): boolean {
  return Intl.supportedValuesOf("currency").includes(currency)
    && new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits === 2;
}

type MinorLine = { accountId: string; debit: number; credit: number };
function opposite(left: readonly MinorLine[], right: readonly MinorLine[]): boolean {
  const signature = (lines: readonly MinorLine[], reverse = false) => {
    const amounts = new Map<string, [number, number]>();
    for (const line of lines) {
      const old = amounts.get(line.accountId) ?? [0, 0];
      amounts.set(line.accountId, [old[0] + (reverse ? line.credit : line.debit),
        old[1] + (reverse ? line.debit : line.credit)]);
    }
    return JSON.stringify([...amounts].sort(([a], [b]) => a.localeCompare(b)));
  };
  return signature(left) === signature(right, true);
}

/** Strict read projection; posting state, accounting definitions and journal writes remain authoritative elsewhere. */
export function buildScopedLedgerPeriodReport(source: LedgerPeriodSource): ScopedLedgerPeriodReport {
  const evidence = { organizationId: source.organizationId, periodKey: source.periodKey, checkedAt: source.checkedAt };
  const missing = (reason: string): ScopedLedgerPeriodReport => ({ ...evidence, availability: "unavailable", currency: null, reason });
  if ((source.periodKey !== null && !isLedgerMonth(source.periodKey)) || !source.organizationId || !Number.isFinite(source.checkedAt.getTime())) {
    return missing("Choose a valid organization and ledger month.");
  }
  const allEntries = [...source.entries, ...source.linkedEntries];
  if (source.truncated || source.accounts.length > LEDGER_PERIOD_LIMITS.accounts
    || allEntries.length > LEDGER_PERIOD_LIMITS.entries
    || allEntries.reduce((count, entry) => count + entry.lines.length, 0) > LEDGER_PERIOD_LIMITS.lines) {
    return missing("This ledger period exceeds the supported report size. Finance needs to review the source scope.");
  }
  if (!source.accounts.some(a => a.type === "revenue") || !source.accounts.some(a => a.type === "expense")) {
    return missing("The ledger needs configured income and expense accounts. Review Finance setup.");
  }
  const currency = source.accounts[0]!.currency;
  if (!isSupportedLedgerCurrency(currency) || source.accounts.some(a => a.currency !== currency)) {
    return missing("The chart needs one supported currency with two minor digits. Review Finance records.");
  }
  const accounts = new Map(source.accounts.map(a => [a.id, a]));
  if (accounts.size !== source.accounts.length || source.accounts.some(a => a.organizationId !== source.organizationId || !isLedgerAccountType(a.type))) {
    return missing("Ledger account ownership or classification needs review.");
  }
  const eligible = source.entries.filter(e => e.status === "posted" || e.status === "reversed");
  if (eligible.length === 0) return missing("No eligible entries are recorded for this period. Review Finance records.");
  if (source.periodKey !== null && eligible.some(e => e.periodKey !== source.periodKey)) return missing("Ledger entries do not match the selected month.");
  const normalized = new Map<string, { entry: LedgerPeriodEntry; lines: MinorLine[] }>();
  let allDebit = 0, allCredit = 0;
  for (const entry of allEntries) {
    if (entry.status === "draft") continue;
    if (normalized.has(entry.id) || entry.organizationId !== source.organizationId || !isLedgerMonth(entry.periodKey)
      || !["posted", "reversed"].includes(entry.status) || entry.currency !== currency
      || entry.lines.length === 0 || entry.lineCount !== entry.lines.length) {
      return missing("Ledger entry scope, currency or completeness needs review.");
    }
    const lines: MinorLine[] = [];
    let debitTotal = 0, creditTotal = 0;
    for (const line of entry.lines) {
      const debit = minorAmount(line.debit), credit = minorAmount(line.credit);
      if (!accounts.has(line.accountId) || line.currency !== currency || debit === null || credit === null
        || (debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
        return missing("Ledger line account, amount precision or currency needs review.");
      }
      debitTotal += debit; creditTotal += credit;
      if (!Number.isSafeInteger(debitTotal) || !Number.isSafeInteger(creditTotal)) return missing("Ledger amounts exceed exact report precision.");
      lines.push({ accountId: line.accountId, debit, credit });
    }
    allDebit += debitTotal; allCredit += creditTotal;
    if (debitTotal !== creditTotal) return missing("A ledger entry is out of balance. Ask Finance to review it.");
    if (!Number.isSafeInteger(allDebit) || !Number.isSafeInteger(allCredit)) return missing("Ledger totals exceed exact report precision.");
    normalized.set(entry.id, { entry, lines });
  }
  const parentOf = (entry: LedgerPeriodEntry): string | null => {
    const legacy = entry.sourceType === "JournalEntry" ? entry.sourceId : null;
    return entry.reversalOfId ?? legacy;
  };
  for (const { entry, lines } of normalized.values()) {
    const legacy = entry.sourceType === "JournalEntry" ? entry.sourceId : null;
    if (entry.reversalOfId && legacy && entry.reversalOfId !== legacy) return missing("Reversal links disagree. Ask Finance to review them.");
    const parentId = parentOf(entry);
    if (entry.sourceType === "JournalEntry" && !parentId) return missing("A reversal has no original entry link.");
    if (parentId) {
      const parent = normalized.get(parentId);
      if (!parent || parent.entry.status !== "reversed" || !opposite(parent.lines, lines)) {
        return missing("A reversal is missing a consistent original entry and opposite amounts.");
      }
    }
    if (entry.status === "reversed") {
      const children = [...normalized.values()].filter(candidate => parentOf(candidate.entry) === entry.id);
      if (children.length !== 1 || children[0]!.entry.status !== "posted" || !opposite(lines, children[0]!.lines)) {
        return missing("A reversed entry needs one proven posted compensation. Ask Finance to review it.");
      }
    }
  }
  const selectedLines = eligible.flatMap(e => normalized.get(e.id)!.lines);
  const trialBalance = computeTrialBalance(source.accounts.map(a => ({ accountId: a.id, code: a.code,
    name: a.name, type: a.type as LedgerAccountType })),
    selectedLines.map(l => ({ accountId: l.accountId, debit: l.debit / 100, credit: l.credit / 100 })));
  const derived = deriveFinancialStatements(trialBalance).incomeStatement;
  const amounts = [derived.revenue, derived.expenses, derived.netIncome];
  if (!trialBalance.balanced || amounts.some(n => !Number.isFinite(n) || !Number.isSafeInteger(toMinorUnits(n)))) {
    return missing("The ledger result exceeds exact report precision or balance controls.");
  }
  return { ...evidence, availability: "available", currency, trialBalance,
    incomeStatement: { revenue: toMinorUnits(derived.revenue) / 100,
      expenses: toMinorUnits(derived.expenses) / 100, netIncome: toMinorUnits(derived.netIncome) / 100 },
    sourceRows: { accounts: source.accounts.length, entries: eligible.length, lines: selectedLines.length } };
}
