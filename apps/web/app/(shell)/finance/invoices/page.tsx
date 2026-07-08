// apps/web/app/(shell)/finance/invoices/page.tsx
import { prisma } from "@dpf/db";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import Link from "next/link";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { PlatformGridSection, parseSurfaceView } from "@/components/workbooks/PlatformGridSection";
import { InvoicesTable, type InvoiceRow } from "./InvoicesTable";

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  sent: "#38bdf8",
  viewed: "#a78bfa",
  overdue: "#ef4444",
  partially_paid: "#fbbf24",
  paid: "#4ade80",
  void: "#6b7280",
  written_off: "#6b7280",
};

const ALL_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "overdue",
  "partially_paid",
  "paid",
];

type Props = { searchParams: Promise<{ status?: string; view?: string }> };

export default async function InvoicesPage({ searchParams }: Props) {
  const { status, view: viewParam } = await searchParams;
  const view = parseSurfaceView(viewParam);

  const [invoices, statusCounts] = await Promise.all([
    prisma.invoice.findMany({
      ...(status ? { where: { status } } : {}),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        invoiceRef: true,
        status: true,
        totalAmount: true,
        currency: true,
        dueDate: true,
        account: { select: { name: true } },
      },
    }),
    prisma.invoice.groupBy({
      by: ["status"],
      _count: true,
    }),
  ]);

  const countByStatus = Object.fromEntries(
    statusCounts.map((s) => [s.status, s._count])
  );
  const totalCount = statusCounts.reduce((sum, s) => sum + s._count, 0);

  const rows: InvoiceRow[] = invoices.map((inv) => ({
    id: inv.id,
    invoiceRef: inv.invoiceRef,
    accountName: inv.account.name,
    status: inv.status,
    dueDateISO: inv.dueDate.toISOString(),
    currencySymbol: getCurrencySymbol(inv.currency),
    amount: Number(inv.totalAmount),
  }));

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
        <span className="text-xs text-[var(--dpf-text)]">Invoices</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Invoices</h1>
        <Link
          href="/finance/invoices/new"
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          New Invoice
        </Link>
      </div>

      <FinanceTabNav />

      <PlatformGridSection entityType="invoice" view={view} />

      {!view && (
        <>
      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/finance/invoices"
          className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
            !status
              ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
              : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          }`}
        >
          All ({totalCount})
        </Link>
        {ALL_STATUSES.map((s) => {
          const colour = STATUS_COLOURS[s] ?? "#6b7280";
          const count = countByStatus[s] ?? 0;
          const isActive = status === s;
          return (
            <Link
              key={s}
              href={`/finance/invoices?status=${s}`}
              className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                isActive
                  ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              }`}
            >
              <span style={{ color: isActive ? undefined : colour }}>
                {s.replace("_", " ")}
              </span>{" "}
              ({count})
            </Link>
          );
        })}
      </div>

      {/* Invoices table */}
      <InvoicesTable rows={rows} />
        </>
      )}
    </div>
  );
}
