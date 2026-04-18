// apps/web/app/(shell)/finance/reports/page.tsx
import Link from "next/link";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";

const REPORTS = [
  {
    title: "Profit & Loss",
    description: "See your revenue, costs, and profit",
    href: "/finance/reports/profit-loss",
    accent: "#4ade80",
  },
  {
    title: "Cash Flow",
    description: "Track money in vs money out",
    href: "/finance/reports/cash-flow",
    accent: "#38bdf8",
  },
  {
    title: "VAT Summary",
    description: "VAT collected vs VAT paid",
    href: "/finance/reports/vat-summary",
    accent: "#a78bfa",
  },
  {
    title: "Revenue by Customer",
    description: "Your biggest revenue sources",
    href: "/finance/reports/revenue-by-customer",
    accent: "#fbbf24",
  },
  {
    title: "Outstanding Invoices",
    description: "Unpaid invoices by urgency",
    href: "/finance/reports/outstanding",
    accent: "#fb923c",
  },
  {
    title: "Aged Debtors",
    description: "Who owes you, and for how long",
    href: "/finance/reports/aged-debtors",
    accent: "#ef4444",
  },
  {
    title: "Aged Creditors",
    description: "What you owe suppliers",
    href: "/finance/reports/aged-creditors",
    accent: "#dc2626",
  },
];

export default function ReportsIndexPage() {
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
        <span className="text-xs text-[var(--dpf-text)]">Reports</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Reports</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Financial reports and analysis
        </p>
      </div>

      <FinanceTabNav />

      {/* Report cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((report) => (
          <Link
            key={report.href}
            href={report.href}
            className="block rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] hover:bg-[var(--dpf-surface-2)] transition-colors overflow-hidden"
            style={{ borderLeftColor: report.accent, borderLeftWidth: "4px" }}
          >
            <div className="p-4">
              <p className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
                {report.title}
              </p>
              <p className="text-xs text-[var(--dpf-muted)]">
                {report.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
