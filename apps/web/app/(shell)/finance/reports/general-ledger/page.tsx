// apps/web/app/(shell)/finance/reports/general-ledger/page.tsx
//
// The General Ledger report: a trial balance and the balance sheet + income
// statement derived from it. This is the payoff of every sub-ledger posting to one
// journal (EP-SAP-PARITY) — the owner sees a real book, derived from the ledger
// rather than recomputed ad hoc from documents. Read-only; the numbers are computed
// by getGeneralLedgerReport (which reuses the pure computeTrialBalance /
// deriveFinancialStatements invariants).

import Link from "next/link";

import { getGeneralLedgerReport } from "@/lib/finance/ledger-service";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { StatCard } from "@/components/ui/report-kit";

interface SearchParams {
  period?: string;
}

export default async function GeneralLedgerReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const periodKey = params.period && /^\d{4}-\d{2}$/.test(params.period) ? params.period : undefined;

  const report = await getGeneralLedgerReport(periodKey);
  const sym = getCurrencySymbol(report.currency);
  const money = (n: number) =>
    `${n < 0 ? "-" : ""}${sym}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

  const {
    trialBalance: tb,
    statements: { incomeStatement: is, balanceSheet: bs },
  } = report;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link
          href="/finance/reports"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Reports
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">General Ledger</span>
      </div>

      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-[var(--dpf-text)]">General Ledger</h1>
        <span className="text-xs text-[var(--dpf-muted)]">
          {report.periodKey ? `Period ${report.periodKey}` : "All time"}
          {" · "}
          {tb.balanced ? "Books balance ✓" : "Out of balance — review"}
        </span>
      </div>

      {report.isEmpty ? (
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-8 text-center">
          <p className="text-[var(--dpf-text)]">No posted entries yet.</p>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Send an invoice, record a payment, or approve a supplier bill and your books appear here
            automatically — no journal entries required.
          </p>
        </div>
      ) : (
        <>
          {/* Income statement */}
          <h2 className="mb-2 text-sm font-semibold text-[var(--dpf-text)]">This period</h2>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Revenue" value={money(is.revenue)} intent="info" />
            <StatCard label="Expenses" value={money(is.expenses)} intent="warning" />
            <StatCard
              label="Net income"
              value={money(is.netIncome)}
              intent={is.netIncome >= 0 ? "success" : "danger"}
              hint={is.netIncome >= 0 ? "Profit" : "Loss"}
            />
          </div>

          {/* Balance sheet */}
          <h2 className="mb-2 text-sm font-semibold text-[var(--dpf-text)]">Financial position</h2>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Assets" value={money(bs.assets)} intent="info" />
            <StatCard label="Liabilities" value={money(bs.liabilities)} intent="warning" />
            <StatCard
              label="Equity + retained"
              value={money(bs.equity + bs.netIncome)}
              intent="neutral"
              hint={bs.balanced ? "Assets = Liabilities + Equity ✓" : "Does not balance"}
            />
          </div>

          {/* Trial balance */}
          <h2 className="mb-2 text-sm font-semibold text-[var(--dpf-text)]">Trial balance</h2>
          <div className="overflow-x-auto rounded-lg border border-[var(--dpf-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
                  <th className="px-4 py-2 text-left text-[10px] font-normal uppercase tracking-widest text-[var(--dpf-muted)]">
                    Code
                  </th>
                  <th className="px-4 py-2 text-left text-[10px] font-normal uppercase tracking-widest text-[var(--dpf-muted)]">
                    Account
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-normal uppercase tracking-widest text-[var(--dpf-muted)]">
                    Debit
                  </th>
                  <th className="px-4 py-2 text-right text-[10px] font-normal uppercase tracking-widest text-[var(--dpf-muted)]">
                    Credit
                  </th>
                </tr>
              </thead>
              <tbody>
                {tb.rows.map((row) => (
                  <tr key={row.accountId} className="border-b border-[var(--dpf-border)] last:border-0">
                    <td className="px-4 py-2 text-[var(--dpf-muted)]">{row.code}</td>
                    <td className="px-4 py-2 text-[var(--dpf-text)]">
                      {row.name}
                      <span className="ml-2 text-[10px] uppercase text-[var(--dpf-muted)]">{row.type}</span>
                    </td>
                    <td className="px-4 py-2 text-right text-[var(--dpf-text)]">
                      {row.debitTotal ? money(row.debitTotal) : ""}
                    </td>
                    <td className="px-4 py-2 text-right text-[var(--dpf-text)]">
                      {row.creditTotal ? money(row.creditTotal) : ""}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[var(--dpf-surface-2)] font-semibold">
                  <td className="px-4 py-2 text-[var(--dpf-text)]" colSpan={2}>
                    Total
                  </td>
                  <td className="px-4 py-2 text-right text-[var(--dpf-text)]">{money(tb.totalDebit)}</td>
                  <td className="px-4 py-2 text-right text-[var(--dpf-text)]">{money(tb.totalCredit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[var(--dpf-muted)]">
            Derived from posted journal entries — every invoice, payment and bill posts here
            automatically.
          </p>
        </>
      )}
    </div>
  );
}
