// apps/web/app/(shell)/finance/reports/revenue-by-customer/page.tsx
import Link from "next/link";
import { getRevenueByCustomer } from "@/lib/actions/reports";

interface SearchParams {
  start?: string;
  end?: string;
}

const formatMoney = (amount: number) =>
  `£${amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

export default async function RevenueByCustomerPage({
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

  const rows = await getRevenueByCustomer(startDate, endDate);

  const totalRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0);
  const totalPaid = rows.reduce((s, r) => s + r.totalPaid, 0);
  const totalOutstanding = rows.reduce((s, r) => s + r.totalOutstanding, 0);
  const totalInvoices = rows.reduce((s, r) => s + r.invoiceCount, 0);

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
        <span className="text-xs text-[var(--dpf-text)]">
          Revenue by Customer
        </span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">
            Revenue by Customer
          </h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            Your biggest revenue sources, sorted by revenue
          </p>
        </div>

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

      {rows.length === 0 ? (
        <div className="p-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-center">
          <p className="text-sm text-[var(--dpf-muted)]">
            No revenue data for this period
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Customer
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Invoices
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Revenue
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Paid
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Outstanding
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.accountId}
                  className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                >
                  <td className="px-4 py-2.5 text-[var(--dpf-text)]">
                    {row.name}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                    {row.invoiceCount}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-text)] font-medium">
                    {formatMoney(row.totalRevenue)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[#4ade80]">
                    {formatMoney(row.totalPaid)}
                  </td>
                  <td
                    className="px-4 py-2.5 text-right"
                    style={{
                      color:
                        row.totalOutstanding > 0 ? "#fbbf24" : "var(--dpf-muted)",
                    }}
                  >
                    {formatMoney(row.totalOutstanding)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-[var(--dpf-border)]">
              <tr>
                <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] font-bold">
                  Total
                </td>
                <td className="px-4 py-3 text-right font-bold text-[var(--dpf-muted)]">
                  {totalInvoices}
                </td>
                <td className="px-4 py-3 text-right font-bold text-[var(--dpf-text)]">
                  {formatMoney(totalRevenue)}
                </td>
                <td className="px-4 py-3 text-right font-bold text-[#4ade80]">
                  {formatMoney(totalPaid)}
                </td>
                <td
                  className="px-4 py-3 text-right font-bold"
                  style={{
                    color: totalOutstanding > 0 ? "#fbbf24" : "var(--dpf-muted)",
                  }}
                >
                  {formatMoney(totalOutstanding)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Export */}
      <Link
        href={`/api/v1/finance/reports/revenue-by-customer?start=${startStr}&end=${endStr}&format=csv`}
        className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] underline"
      >
        Export CSV
      </Link>
    </div>
  );
}
