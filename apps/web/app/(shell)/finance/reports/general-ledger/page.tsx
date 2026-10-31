import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { isLedgerMonth } from "@/lib/finance/ledger-period-report";
import { deriveFinancialStatements } from "@/lib/finance/ledger";
import { resolvePerformanceOrganizationContext, type PerformanceOrganizationContextDataSource } from "@/lib/performance/performance-organization-context";

import { getGeneralLedgerReport } from "@/lib/finance/ledger-service";
import { StatCard } from "@/components/ui/report-kit";

interface SearchParams {
  period?: string | string[];
}

export default async function GeneralLedgerReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "view_finance")) notFound();
  const params = await searchParams;
  const periodKey = params.period === undefined ? null : params.period;
  const unavailable = (reason: string, retry = false) => (
    <main className="space-y-3">
      <h1 className="text-xl font-semibold">General Ledger</h1>
      <p>{reason}</p>
      <Link href={retry ? `/finance/reports/general-ledger${typeof periodKey === "string" ? `?period=${periodKey}` : ""}` : "/finance"} data-dpf-primary-action>{retry ? "Try again" : "Open Finance"}</Link>
    </main>
  );
  if (periodKey !== null && (typeof periodKey !== "string" || !isLedgerMonth(periodKey))) {
    return unavailable("Choose one valid ledger month.");
  }
  const context = await resolvePerformanceOrganizationContext(prisma as unknown as PerformanceOrganizationContextDataSource, session.user.id);
  if (context.status !== "resolved") return unavailable(context.reason);
  let report;
  try { report = await getGeneralLedgerReport(context.organizationId, periodKey); }
  catch { return unavailable("Finance records could not be read.", true); }
  if (report.availability !== "available") return unavailable(report.reason);
  const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: report.currency }).format(value);
  const tb = report.trialBalance;
  const { incomeStatement: is, balanceSheet: bs } = deriveFinancialStatements(tb);

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
          {report.periodKey ? `Period ${report.periodKey}` : "All recorded"}
          {" · "}
          {tb.balanced ? report.currency : "Out of balance — review"}
        </span>
      </div>

      <>
          {/* Income statement */}
          <h2 className="mb-2 text-sm font-semibold text-[var(--dpf-text)]">Recorded result</h2>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Income" value={money(is.revenue)} intent="info" />
            <StatCard label="Expenses" value={money(is.expenses)} intent="warning" />
            <StatCard
              label="Net result"
              value={money(is.netIncome)}
              intent={is.netIncome >= 0 ? "success" : "danger"}
              hint={is.netIncome >= 0 ? "Profit" : "Loss"}
            />
          </div>

          {/* Balance sheet */}
          <h2 className="mb-2 text-sm font-semibold text-[var(--dpf-text)]">Recorded movements</h2>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="Asset movement" value={money(bs.assets)} intent="info" />
            <StatCard label="Liability movement" value={money(bs.liabilities)} intent="warning" />
            <StatCard
              label="Equity and result"
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
            Available ledger records only; not a verified bank balance or as-of position.
          </p>
      </>
    </div>
  );
}
