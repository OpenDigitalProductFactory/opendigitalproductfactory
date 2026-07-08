// apps/web/app/(shell)/finance/recurring/page.tsx
import { listRecurringSchedules } from "@/lib/actions/recurring";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import Link from "next/link";
import { RecurringTable, type RecurringRow } from "./RecurringTable";

const SCHEDULE_STATUS_COLOURS: Record<string, string> = {
  active: "#4ade80",
  paused: "#fbbf24",
  cancelled: "#ef4444",
  completed: "#8888a0",
};

const ALL_STATUSES = ["active", "paused", "cancelled", "completed"];

type Props = { searchParams: Promise<{ status?: string }> };

export default async function RecurringPage({ searchParams }: Props) {
  const { status } = await searchParams;

  const schedules = status
    ? await listRecurringSchedules({ status })
    : await listRecurringSchedules();

  const rows: RecurringRow[] = schedules.map((sched) => ({
    id: sched.id,
    scheduleId: sched.scheduleId,
    name: sched.name,
    customerName: sched.account.name,
    frequency: sched.frequency,
    currency: sched.currency,
    amount: Number(sched.amount),
    nextInvoiceDateISO: new Date(sched.nextInvoiceDate).toISOString(),
    status: sched.status,
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
        <span className="text-xs text-[var(--dpf-text)]">Recurring</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">
          Recurring Schedules
        </h1>
        <Link
          href="/finance/recurring/new"
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          New Schedule
        </Link>
      </div>

      <FinanceTabNav />

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href="/finance/recurring"
          className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
            !status
              ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
              : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          }`}
        >
          All
        </Link>
        {ALL_STATUSES.map((s) => {
          const colour = SCHEDULE_STATUS_COLOURS[s] ?? "#6b7280";
          const isActive = status === s;
          return (
            <Link
              key={s}
              href={`/finance/recurring?status=${s}`}
              className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                isActive
                  ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              }`}
            >
              <span style={{ color: isActive ? undefined : colour }}>
                {s}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Schedules table */}
      {schedules.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">
          No recurring schedules found. Create one to automate your invoicing.
        </p>
      ) : (
        <RecurringTable rows={rows} />
      )}
    </div>
  );
}
