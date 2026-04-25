// apps/web/app/(shell)/customer/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";
import { NewCustomerButton } from "@/components/customer/NewCustomerButton";

const STATUS_COLOURS: Record<string, string> = {
  prospect: "#fbbf24",
  qualified: "#fb923c",
  onboarding: "#38bdf8",
  active: "#4ade80",
  at_risk: "#ef4444",
  suspended: "#8888a0",
  closed: "#555566",
};

export default async function CustomerPage() {
  const [accounts, engagementCounts, opportunityCounts, quoteCounts, orderCounts] =
    await Promise.all([
      prisma.customerAccount.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true,
          accountId: true,
          name: true,
          status: true,
          industry: true,
          _count: { select: { contacts: true, opportunities: true } },
        },
      }),
      prisma.engagement.groupBy({
        by: ["status"],
        _count: true,
      }),
      prisma.opportunity.groupBy({
        by: ["stage"],
        _count: true,
        _sum: { expectedValue: true },
      }),
      prisma.quote.groupBy({
        by: ["status"],
        _count: true,
      }),
      prisma.salesOrder.groupBy({
        by: ["status"],
        _count: true,
      }),
    ]);

  const engTotal = engagementCounts.reduce((s, e) => s + e._count, 0);
  const engNew = engagementCounts.find((e) => e.status === "new")?._count ?? 0;

  const openStages = ["qualification", "discovery", "proposal", "negotiation"];
  const openOpps = opportunityCounts.filter((o) => openStages.includes(o.stage));
  const pipelineCount = openOpps.reduce((s, o) => s + o._count, 0);
  const pipelineValue = openOpps.reduce(
    (s, o) => s + Number(o._sum.expectedValue ?? 0),
    0,
  );

  const quoteDraft = quoteCounts.find((q) => q.status === "draft")?._count ?? 0;
  const quoteSent = quoteCounts.find((q) => q.status === "sent")?._count ?? 0;

  const ordersActive = orderCounts
    .filter((o) => o.status === "confirmed" || o.status === "in_progress")
    .reduce((s, o) => s + o._count, 0);

  const summaryCards = [
    { label: "Engagements", value: engTotal, sub: `${engNew} new`, color: "#fb923c", href: "/customer/engagements" },
    { label: "Pipeline", value: pipelineCount, sub: `$${pipelineValue.toLocaleString()}`, color: "var(--dpf-accent)", href: "/customer/opportunities" },
    { label: "Quotes", value: quoteDraft + quoteSent, sub: `${quoteSent} sent`, color: "#38bdf8", href: "/customer/quotes" },
    { label: "Orders", value: ordersActive, sub: "active", color: "#4ade80", href: "/customer/sales-orders" },
  ];

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Customer</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""}
          </p>
        </div>
        <NewCustomerButton />
      </div>

      {/* Pipeline summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {summaryCards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border-l-2 hover:bg-[var(--dpf-surface-2)] transition-colors"
            style={{ borderLeftColor: c.color }}
          >
            <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider">
              {c.label}
            </p>
            <p className="text-lg font-bold text-[var(--dpf-text)]">{c.value}</p>
            <p className="text-[10px]" style={{ color: c.color }}>
              {c.sub}
            </p>
          </Link>
        ))}
      </div>

      {/* Account list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {accounts.map((a) => {
          const statusColour = STATUS_COLOURS[a.status] ?? "#8888a0";
          return (
            <Link
              key={a.id}
              href={`/customer/${a.id}`}
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4 hover:bg-[var(--dpf-surface-2)] transition-colors"
              style={{ borderLeftColor: "#f472b6" }}
            >
              <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                {a.accountId}
              </p>
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-[var(--dpf-text)] leading-tight">
                  {a.name}
                </p>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: `${statusColour}20`, color: statusColour }}
                >
                  {a.status}
                </span>
              </div>
              <div className="flex gap-3 text-[9px] text-[var(--dpf-muted)]">
                <span>{a._count.contacts} contact{a._count.contacts !== 1 ? "s" : ""}</span>
                {a._count.opportunities > 0 && (
                  <span>{a._count.opportunities} opportunit{a._count.opportunities !== 1 ? "ies" : "y"}</span>
                )}
                {a.industry && <span>{a.industry}</span>}
              </div>
            </Link>
          );
        })}
      </div>

      {accounts.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No accounts registered yet.</p>
      )}
    </div>
  );
}
