// apps/web/app/(shell)/finance/reports/vat-summary/page.tsx
import Link from "next/link";
import { getVatSummary } from "@/lib/actions/reports";

interface SearchParams {
  start?: string;
  end?: string;
}

const formatMoney = (amount: number) =>
  `£${Math.abs(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

export default async function VatSummaryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const now = new Date();
  // Default to current quarter
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);

  const startDate = params.start ? new Date(params.start) : quarterStart;
  const endDate = params.end ? new Date(params.end) : now;

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const data = await getVatSummary(startDate, endDate);

  const summaryText =
    data.netVat > 0
      ? `You owe ${formatMoney(data.netVat)} in VAT this period`
      : data.netVat < 0
        ? `You are owed a ${formatMoney(data.netVat)} VAT refund this period`
        : "No VAT to report for this period";

  const summaryColour =
    data.netVat > 0 ? "#ef4444" : data.netVat < 0 ? "#4ade80" : "var(--dpf-muted)";

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
        <span className="text-xs text-[var(--dpf-text)]">VAT Summary</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">
            VAT Summary
          </h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            VAT collected vs VAT paid
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

      {/* Plain-language summary */}
      <div className="mb-6 p-5 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <p className="text-2xl font-bold" style={{ color: summaryColour }}>
          {summaryText}
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
                Output VAT (collected on {data.invoiceCount} invoice
                {data.invoiceCount !== 1 ? "s" : ""})
              </td>
              <td className="px-4 py-3 text-right text-[var(--dpf-text)]">
                {formatMoney(data.outputVat)}
              </td>
            </tr>
            <tr className="border-b border-[var(--dpf-border)]">
              <td className="px-4 py-3 text-[var(--dpf-text)]">
                Input VAT (paid on {data.billCount} bill
                {data.billCount !== 1 ? "s" : ""})
              </td>
              <td className="px-4 py-3 text-right text-[var(--dpf-text)]">
                ({formatMoney(data.inputVat)})
              </td>
            </tr>
            <tr className="bg-[var(--dpf-surface-1)]">
              <td className="px-4 py-3 font-bold text-[var(--dpf-text)]">
                Net VAT
              </td>
              <td
                className="px-4 py-3 text-right font-bold"
                style={{ color: summaryColour }}
              >
                {data.netVat >= 0
                  ? formatMoney(data.netVat)
                  : `(${formatMoney(data.netVat)})`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Export */}
      <Link
        href={`/api/v1/finance/reports/vat-summary?start=${startStr}&end=${endStr}&format=csv`}
        className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] underline"
      >
        Export CSV
      </Link>
    </div>
  );
}
