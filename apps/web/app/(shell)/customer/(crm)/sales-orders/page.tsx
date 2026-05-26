// apps/web/app/(shell)/customer/sales-orders/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";
import { CustomerStatusBadge } from "@/components/customer/CustomerStatusBadge";
import { CRM_TONE_CLASSES, getSalesOrderStatusMeta } from "@/lib/crm/presentation";

export default async function SalesOrdersPage() {
  const orders = await prisma.salesOrder.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      quote: { select: { id: true, quoteNumber: true } },
      account: { select: { id: true, accountId: true, name: true } },
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Sales Orders</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {orders.length} order{orders.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="space-y-2">
        {orders.map((o) => {
          const statusMeta = getSalesOrderStatusMeta(o.status);
          const toneClasses = CRM_TONE_CLASSES[statusMeta.tone];
          return (
            <div
              key={o.id}
              className={[
                "flex items-center justify-between rounded-lg border-l-4 bg-[var(--dpf-surface-1)] p-4",
                toneClasses.border,
              ].join(" ")}
            >
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-mono font-semibold text-[var(--dpf-text)]">
                    {o.orderRef}
                  </p>
                  <CustomerStatusBadge label={statusMeta.label} tone={statusMeta.tone} />
                </div>
                <p className="text-xs text-[var(--dpf-muted)]">
                  <Link href={`/customer/${o.account.id}`} className="hover:text-[var(--dpf-text)]">
                    {o.account.name}
                  </Link>
                  <span className="mx-1">·</span>
                  from {o.quote.quoteNumber}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-mono font-semibold text-[var(--dpf-text)]">
                  {o.currency} {Number(o.totalAmount).toLocaleString()}
                </p>
                <p className="text-[9px] text-[var(--dpf-muted)]">
                  {new Date(o.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {orders.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No sales orders yet.</p>
      )}
    </div>
  );
}
