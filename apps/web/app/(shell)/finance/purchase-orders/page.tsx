// apps/web/app/(shell)/finance/purchase-orders/page.tsx
import { listPurchaseOrders } from "@/lib/actions/ap";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import Link from "next/link";
import { PurchaseOrdersTable, type PurchaseOrderRow } from "./PurchaseOrdersTable";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  sent: "#38bdf8",
  acknowledged: "#a78bfa",
  received: "#4ade80",
  cancelled: "#6b7280",
};

const ALL_STATUSES = ["draft", "sent", "acknowledged", "received", "cancelled"];

type Props = { searchParams: Promise<{ status?: string; supplierId?: string }> };

export default async function PurchaseOrdersPage({ searchParams }: Props) {
  const { status, supplierId } = await searchParams;

  const [orders, orgSettings] = await Promise.all([
    listPurchaseOrders({
      ...(status ? { status } : {}),
      ...(supplierId ? { supplierId } : {}),
    }),
    getOrgSettings(),
  ]);
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const rows: PurchaseOrderRow[] = orders.map((po) => ({
    id: po.id,
    poNumber: po.poNumber,
    supplierName: po.supplier.name,
    status: po.status,
    deliveryDateISO: po.deliveryDate ? new Date(po.deliveryDate).toISOString() : null,
    amount: Number(po.totalAmount),
  }));

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Purchase Orders</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Purchase Orders</h1>
        <Link
          href="/finance/purchase-orders/new"
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          New PO
        </Link>
      </div>

      <FinanceTabNav />

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/finance/purchase-orders"
          className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
            !status
              ? "border-[var(--dpf-accent)] text-white bg-[var(--dpf-accent)]/10"
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
              href={`/finance/purchase-orders?status=${s}`}
              className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                isActive
                  ? "border-[var(--dpf-accent)] text-white bg-[var(--dpf-accent)]/10"
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

      {/* PO table */}
      <PurchaseOrdersTable rows={rows} currencySymbol={sym} />
    </div>
  );
}
