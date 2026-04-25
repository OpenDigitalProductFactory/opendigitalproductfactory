// apps/web/app/(shell)/customer/sales-orders/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";

const STATUS_COLOURS: Record<string, string> = {
  confirmed: "#38bdf8",
  in_progress: "#fbbf24",
  fulfilled: "#4ade80",
  cancelled: "#ef4444",
};

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
          const color = STATUS_COLOURS[o.status] ?? "#8888a0";
          return (
            <div
              key={o.id}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4 flex items-center justify-between"
              style={{ borderLeftColor: color }}
            >
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-mono font-semibold text-[var(--dpf-text)]">
                    {o.orderRef}
                  </p>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full"
                    style={{ background: `${color}20`, color }}
                  >
                    {o.status.replace("_", " ")}
                  </span>
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
