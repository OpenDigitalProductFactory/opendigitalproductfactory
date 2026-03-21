// apps/web/app/(shell)/finance/reports/cash-flow/page.tsx
import Link from "next/link";
import { getCashFlowReport } from "@/lib/actions/reports";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";

interface SearchParams {
  start?: string;
  end?: string;
}

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const startDate = params.start ? new Date(params.start) : defaultStart;
  const endDate = params.end ? new Date(params.end) : now;

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const orgSettings = await getOrgSettings();
  const sym = getCurrencySymbol(orgSettings.baseCurrency);
  const formatMoney = (amount: number) =>
    `${sym}${Math.abs(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

  const data = await getCashFlowReport(startDate, endDate);

  const netColour = data.netCashFlow >= 0 ? "#4ade80" : "#ef4444";
  const netSign = data.netCashFlow >= 0 ? "+" : "-";

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link
          href="/finance"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
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
        <span className="text-xs text-[var(--dpf-text)]">Cash Flow</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">
            Cash Flow
          </h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            Money in vs money out for the selected period
          </p>
        </div>

        {/* Date range */}
        <form method="get" className="flex items-center gap-2">
          <label className="text-xs text-[var(--dpf-muted)]">From</label>
          <input
            type="date"
            name="start"
            defaultValue={startStr}
            className="text-xs px-2 py-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]"
          />
          <label className="text-xs text-[var(--dpf-muted)]">To</label>
          <input
            type="date"
            name="end"
            defaultValue={endStr}
            className="text-xs px-2 py-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]"
          />
          <button
            type="submit"
            className="text-xs px-3 py-1 rounded bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
          >
            Apply
          </button>
        </form>
      </div>

      {/* Plain-language summary */}
      <div className="mb-6 p-5 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <p className="text-lg font-bold text-[var(--dpf-text)]">
          {formatMoney(data.moneyIn)} came in, {formatMoney(data.moneyOut)} went
          out.{" "}
          <span style={{ color: netColour }}>
            Net: {netSign}
            {formatMoney(data.netCashFlow)}
          </span>
        </p>
        <p className="text-xs text-[var(--dpf-muted)] mt-1">
          {startDate.toLocaleDateString("en-GB")} –{" "}
          {endDate.toLocaleDateString("en-GB")}
        </p>
      </div>

      {/* Report table */}
      <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--dpf-border)]">
              <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                Item
              </th>
              <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Money In */}
            <tr className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
              <td className="px-4 py-3 font-semibold text-[var(--dpf-text)]">
                Money In
              </td>
              <td className="px-4 py-3 text-right font-semibold text-[#4ade80]">
                {formatMoney(data.moneyIn)}
              </td>
            </tr>
            {data.inboundBreakdown.map((item) => (
              <tr
                key={`in-${item.method}`}
                className="border-b border-[var(--dpf-border)]"
              >
                <td className="pl-8 pr-4 py-2.5 text-xs text-[var(--dpf-muted)]">
                  — {item.method.replace(/_/g, " ")}
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-[var(--dpf-muted)]">
                  {formatMoney(item.total)}
                </td>
              </tr>
            ))}

            {/* Money Out */}
            <tr className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
              <td className="px-4 py-3 font-semibold text-[var(--dpf-text)]">
                Money Out
              </td>
              <td className="px-4 py-3 text-right font-semibold text-[#ef4444]">
                ({formatMoney(data.moneyOut)})
              </td>
            </tr>
            {data.outboundBreakdown.map((item) => (
              <tr
                key={`out-${item.method}`}
                className="border-b border-[var(--dpf-border)]"
              >
                <td className="pl-8 pr-4 py-2.5 text-xs text-[var(--dpf-muted)]">
                  — {item.method.replace(/_/g, " ")}
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-[var(--dpf-muted)]">
                  ({formatMoney(item.total)})
                </td>
              </tr>
            ))}

            {/* Net Cash Flow */}
            <tr className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
              <td className="px-4 py-3 font-bold text-[var(--dpf-text)]">
                Net Cash Flow
              </td>
              <td
                className="px-4 py-3 text-right font-bold"
                style={{ color: netColour }}
              >
                {netSign}
                {formatMoney(data.netCashFlow)}
              </td>
            </tr>

            {/* Closing Balance */}
            <tr>
              <td className="px-4 py-3 text-[var(--dpf-text)]">
                Closing Balance
              </td>
              <td
                className="px-4 py-3 text-right"
                style={{
                  color: data.closingBalance >= 0 ? "#4ade80" : "#ef4444",
                }}
              >
                {data.closingBalance >= 0
                  ? formatMoney(data.closingBalance)
                  : `(${formatMoney(data.closingBalance)})`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Export */}
      <Link
        href={`/api/v1/finance/reports/cash-flow?start=${startStr}&end=${endStr}&format=csv`}
        className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] underline"
      >
        Export CSV
      </Link>
    </div>
  );
}
