// apps/web/app/(shell)/finance/bills/page.tsx
import { listBills } from "@/lib/actions/ap";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import Link from "next/link";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  awaiting_approval: "#a78bfa",
  approved: "#38bdf8",
  partially_paid: "#fbbf24",
  paid: "#4ade80",
  void: "#6b7280",
};

const ALL_STATUSES = ["draft", "awaiting_approval", "approved", "partially_paid", "paid"];

type Props = { searchParams: Promise<{ status?: string; supplierId?: string }> };

export default async function BillsPage({ searchParams }: Props) {
  const { status, supplierId } = await searchParams;

  const [bills, orgSettings] = await Promise.all([
    listBills({
      ...(status ? { status } : {}),
      ...(supplierId ? { supplierId } : {}),
    }),
    getOrgSettings(),
  ]);
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const formatMoney = (amount: unknown) =>
    Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2 });

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Bills</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Bills</h1>
        <Link
          href="/finance/bills/new"
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          New Bill
        </Link>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/finance/bills"
          className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
            !status
              ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
              : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          }`}
        >
          All
        </Link>
        {ALL_STATUSES.map((s) => {
          const colour = STATUS_COLOURS[s] ?? "#6b7280";
          const isActive = status === s;
          return (
            <Link
              key={s}
              href={`/finance/bills?status=${s}`}
              className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                isActive
                  ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              }`}
            >
              <span style={{ color: isActive ? undefined : colour }}>
                {s.replace(/_/g, " ")}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Bills table */}
      {bills.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No bills found.</p>
      ) : (
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Ref
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Supplier
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Status
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Due Date
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => {
                const colour = STATUS_COLOURS[bill.status] ?? "#6b7280";
                return (
                  <tr
                    key={bill.id}
                    className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/finance/bills/${bill.id}`}
                        className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
                      >
                        {bill.billRef}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/finance/bills/${bill.id}`}
                        className="text-[var(--dpf-text)] hover:underline"
                      >
                        {bill.supplier.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{ color: colour, backgroundColor: `${colour}20` }}
                      >
                        {bill.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                      {new Date(bill.dueDate).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                      {sym}{formatMoney(bill.totalAmount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
