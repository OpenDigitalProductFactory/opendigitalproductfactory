// apps/web/app/(shell)/customer/quotes/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  sent: "#38bdf8",
  accepted: "#4ade80",
  rejected: "#ef4444",
  expired: "#fbbf24",
  superseded: "#555566",
};

export default async function QuotesPage() {
  const quotes = await prisma.quote.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      opportunity: { select: { id: true, opportunityId: true, title: true } },
      account: { select: { id: true, accountId: true, name: true } },
      lineItems: { select: { id: true } },
      salesOrder: { select: { id: true, orderRef: true } },
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Quotes</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {quotes.length} quote{quotes.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="space-y-2">
        {quotes.map((q) => {
          const color = STATUS_COLOURS[q.status] ?? "#8888a0";
          return (
            <Link
              key={q.id}
              href={`/customer/quotes/${q.id}`}
              className="block p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4 hover:bg-[var(--dpf-surface-2)] transition-colors"
              style={{ borderLeftColor: color }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-xs font-mono font-semibold text-[var(--dpf-text)]">
                      {q.quoteNumber}
                    </p>
                    <span className="text-[9px] text-[var(--dpf-muted)]">v{q.version}</span>
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{ background: `${color}20`, color }}
                    >
                      {q.status}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--dpf-muted)]">
                    {q.account.name} · {q.opportunity.title}
                  </p>
                  <p className="text-[9px] text-[var(--dpf-muted)] mt-1">
                    {q.lineItems.length} line item{q.lineItems.length !== 1 ? "s" : ""}
                    {q.salesOrder && (
                      <span className="ml-2 text-[var(--dpf-accent)]">
                        → {q.salesOrder.orderRef}
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-mono font-semibold text-[var(--dpf-text)]">
                    {q.currency} {Number(q.totalAmount).toLocaleString()}
                  </p>
                  <p className="text-[9px] text-[var(--dpf-muted)]">
                    Valid until {new Date(q.validUntil).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {quotes.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No quotes created yet.</p>
      )}
    </div>
  );
}
