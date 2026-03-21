// apps/web/app/(shell)/finance/reports/aged-creditors/page.tsx
import { getAgedCreditors } from "@/lib/actions/dunning";
import Link from "next/link";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";

const COLUMN_COLOURS = {
  current: "#4ade80",
  days30: "#fbbf24",
  days60: "#fb923c",
  days90: "#ef4444",
  days90plus: "#dc2626",
};

export default async function AgedCreditorsPage() {
  const { rows, grandTotals } = await getAgedCreditors();
  const orgSettings = await getOrgSettings();
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const formatMoney = (amount: number) =>
    `${sym}${amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;

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
        <Link href="/finance/reports" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Reports</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Aged Creditors</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">
          Aged Creditors
        </h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Outstanding bills grouped by age
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="p-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-center">
          <p className="text-sm text-[var(--dpf-muted)]">
            No outstanding invoices
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Supplier
                </th>
                <th
                  className="text-right text-[10px] uppercase tracking-widest px-4 py-2 font-normal"
                  style={{ color: COLUMN_COLOURS.current }}
                >
                  Current
                </th>
                <th
                  className="text-right text-[10px] uppercase tracking-widest px-4 py-2 font-normal"
                  style={{ color: COLUMN_COLOURS.days30 }}
                >
                  1–30 days
                </th>
                <th
                  className="text-right text-[10px] uppercase tracking-widest px-4 py-2 font-normal"
                  style={{ color: COLUMN_COLOURS.days60 }}
                >
                  31–60 days
                </th>
                <th
                  className="text-right text-[10px] uppercase tracking-widest px-4 py-2 font-normal"
                  style={{ color: COLUMN_COLOURS.days90 }}
                >
                  61–90 days
                </th>
                <th
                  className="text-right text-[10px] uppercase tracking-widest px-4 py-2 font-normal"
                  style={{ color: COLUMN_COLOURS.days90plus }}
                >
                  90+ days
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.supplierId}
                  className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                >
                  <td className="px-4 py-2.5 text-[var(--dpf-text)]">
                    {row.supplierName}
                  </td>
                  <td
                    className="px-4 py-2.5 text-right"
                    style={{ color: row.current > 0 ? COLUMN_COLOURS.current : "var(--dpf-muted)" }}
                  >
                    {formatMoney(row.current)}
                  </td>
                  <td
                    className="px-4 py-2.5 text-right"
                    style={{ color: row.days30 > 0 ? COLUMN_COLOURS.days30 : "var(--dpf-muted)" }}
                  >
                    {formatMoney(row.days30)}
                  </td>
                  <td
                    className="px-4 py-2.5 text-right"
                    style={{ color: row.days60 > 0 ? COLUMN_COLOURS.days60 : "var(--dpf-muted)" }}
                  >
                    {formatMoney(row.days60)}
                  </td>
                  <td
                    className="px-4 py-2.5 text-right"
                    style={{ color: row.days90 > 0 ? COLUMN_COLOURS.days90 : "var(--dpf-muted)" }}
                  >
                    {formatMoney(row.days90)}
                  </td>
                  <td
                    className="px-4 py-2.5 text-right"
                    style={{ color: row.days90plus > 0 ? COLUMN_COLOURS.days90plus : "var(--dpf-muted)" }}
                  >
                    {formatMoney(row.days90plus)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold text-[var(--dpf-text)]">
                    {formatMoney(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-[var(--dpf-border)]">
              <tr>
                <td className="px-4 py-3 text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] font-bold">
                  Grand Total
                </td>
                <td
                  className="px-4 py-3 text-right font-bold"
                  style={{ color: COLUMN_COLOURS.current }}
                >
                  {formatMoney(grandTotals.current)}
                </td>
                <td
                  className="px-4 py-3 text-right font-bold"
                  style={{ color: COLUMN_COLOURS.days30 }}
                >
                  {formatMoney(grandTotals.days30)}
                </td>
                <td
                  className="px-4 py-3 text-right font-bold"
                  style={{ color: COLUMN_COLOURS.days60 }}
                >
                  {formatMoney(grandTotals.days60)}
                </td>
                <td
                  className="px-4 py-3 text-right font-bold"
                  style={{ color: COLUMN_COLOURS.days90 }}
                >
                  {formatMoney(grandTotals.days90)}
                </td>
                <td
                  className="px-4 py-3 text-right font-bold"
                  style={{ color: COLUMN_COLOURS.days90plus }}
                >
                  {formatMoney(grandTotals.days90plus)}
                </td>
                <td className="px-4 py-3 text-right font-bold text-[var(--dpf-text)]">
                  {formatMoney(grandTotals.total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
