// apps/web/app/(shell)/finance/reports/profit-loss/page.tsx
import Link from "next/link";
import { getProfitAndLoss } from "@/lib/actions/reports";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";

interface SearchParams {
  start?: string;
  end?: string;
}

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultEnd = now;

  const startDate = params.start ? new Date(params.start) : defaultStart;
  const endDate = params.end ? new Date(params.end) : defaultEnd;

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const orgSettings = await getOrgSettings();
  const sym = getCurrencySymbol(orgSettings.baseCurrency);
  const formatMoney = (amount: number) =>
    `${sym}${Math.abs(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

  const data = await getProfitAndLoss(startDate, endDate);

  const profitColour = data.netProfit >= 0 ? "#4ade80" : "#ef4444";
  const profitLabel =
    data.netProfit >= 0
      ? `You made ${formatMoney(data.netProfit)} profit this period`
      : `You made a ${formatMoney(data.netProfit)} loss this period`;

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
        <span className="text-xs text-[var(--dpf-text)]">Profit &amp; Loss</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">
            Profit &amp; Loss
          </h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            Revenue, costs, and profit for the selected period
          </p>
        </div>

        {/* Date range inputs */}
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
        <p className="text-2xl font-bold" style={{ color: profitColour }}>
          {profitLabel}
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
            <tr className="border-b border-[var(--dpf-border)]">
              <td className="px-4 py-3 text-[var(--dpf-text)]">
                Money In (Revenue)
              </td>
              <td className="px-4 py-3 text-right text-[var(--dpf-text)]">
                {formatMoney(data.revenue)}
              </td>
            </tr>
            <tr className="border-b border-[var(--dpf-border)]">
              <td className="px-4 py-3 text-[var(--dpf-text)]">
                Money Out (Cost of Sales)
              </td>
              <td className="px-4 py-3 text-right text-[var(--dpf-text)]">
                ({formatMoney(data.costOfSales)})
              </td>
            </tr>
            <tr className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
              <td className="px-4 py-3 font-semibold text-[var(--dpf-text)]">
                Gross Profit
              </td>
              <td
                className="px-4 py-3 text-right font-semibold"
                style={{ color: data.grossProfit >= 0 ? "#4ade80" : "#ef4444" }}
              >
                {data.grossProfit >= 0
                  ? formatMoney(data.grossProfit)
                  : `(${formatMoney(data.grossProfit)})`}
              </td>
            </tr>
            <tr className="border-b border-[var(--dpf-border)]">
              <td className="px-4 py-3 text-[var(--dpf-text)]">Expenses</td>
              <td className="px-4 py-3 text-right text-[var(--dpf-text)]">
                ({formatMoney(data.expenses)})
              </td>
            </tr>
            <tr className="bg-[var(--dpf-surface-1)]">
              <td className="px-4 py-3 font-bold text-[var(--dpf-text)]">
                Net Profit
              </td>
              <td
                className="px-4 py-3 text-right font-bold"
                style={{ color: profitColour }}
              >
                {data.netProfit >= 0
                  ? formatMoney(data.netProfit)
                  : `(${formatMoney(data.netProfit)})`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Counts */}
      <p className="text-xs text-[var(--dpf-muted)] mb-4">
        Based on {data.invoiceCount} paid invoice
        {data.invoiceCount !== 1 ? "s" : ""}, {data.billCount} paid bill
        {data.billCount !== 1 ? "s" : ""}, and {data.expenseCount} expense claim
        {data.expenseCount !== 1 ? "s" : ""}.
      </p>

      {/* Export */}
      <Link
        href={`/api/v1/finance/reports/profit-loss?start=${startStr}&end=${endStr}&format=csv`}
        className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] underline"
      >
        Export CSV
      </Link>
    </div>
  );
}
