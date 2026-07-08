// apps/web/app/(shell)/finance/bills/page.tsx
import { listBills } from "@/lib/actions/ap";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import Link from "next/link";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { PlatformGridSection, parseSurfaceView } from "@/components/workbooks/PlatformGridSection";
import { BillsTable, type BillRow } from "./BillsTable";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  awaiting_approval: "#a78bfa",
  approved: "#38bdf8",
  partially_paid: "#fbbf24",
  paid: "#4ade80",
  void: "#6b7280",
};

const ALL_STATUSES = ["draft", "awaiting_approval", "approved", "partially_paid", "paid"];

type Props = { searchParams: Promise<{ status?: string; supplierId?: string; view?: string }> };

export default async function BillsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { status, supplierId } = sp;
  const view = parseSurfaceView(sp.view);

  const [bills, orgSettings] = await Promise.all([
    listBills({
      ...(status ? { status } : {}),
      ...(supplierId ? { supplierId } : {}),
    }),
    getOrgSettings(),
  ]);
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const rows: BillRow[] = bills.map((bill) => ({
    id: bill.id,
    billRef: bill.billRef,
    supplierName: bill.supplier.name,
    status: bill.status,
    dueDateISO: new Date(bill.dueDate).toISOString(),
    amount: Number(bill.totalAmount),
  }));

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

      <FinanceTabNav />

      <PlatformGridSection entityType="bill" view={view} />

      {!view && (<>
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
      <BillsTable rows={rows} currencySymbol={sym} />
      </>)}
    </div>
  );
}
