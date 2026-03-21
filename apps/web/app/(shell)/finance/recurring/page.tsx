// apps/web/app/(shell)/finance/recurring/page.tsx
import { listRecurringSchedules } from "@/lib/actions/recurring";
import Link from "next/link";

const SCHEDULE_STATUS_COLOURS: Record<string, string> = {
  active: "#4ade80",
  paused: "#fbbf24",
  cancelled: "#ef4444",
  completed: "#8888a0",
};

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

const ALL_STATUSES = ["active", "paused", "cancelled", "completed"];

type Props = { searchParams: Promise<{ status?: string }> };

export default async function RecurringPage({ searchParams }: Props) {
  const { status } = await searchParams;

  const schedules = await listRecurringSchedules(status ? { status } : undefined);

  const formatMoney = (amount: number) =>
    amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });

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
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Name
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Customer
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Frequency
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Amount
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Next Invoice
                </th>
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((sched) => {
                const statusColour =
                  SCHEDULE_STATUS_COLOURS[sched.status] ?? "#6b7280";
                return (
                  <tr
                    key={sched.id}
                    className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/finance/recurring/${sched.id}`}
                        className="text-[var(--dpf-text)] hover:underline font-medium"
                      >
                        {sched.name}
                      </Link>
                      <div className="text-[9px] font-mono text-[var(--dpf-muted)] mt-0.5">
                        {sched.scheduleId}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                      {sched.account.name}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{
                          color: "#38bdf8",
                          backgroundColor: "#38bdf820",
                        }}
                      >
                        {FREQUENCY_LABELS[sched.frequency] ?? sched.frequency}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                      {sched.currency} {formatMoney(Number(sched.amount))}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                      {new Date(sched.nextInvoiceDate).toLocaleDateString(
                        "en-GB",
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full"
                        style={{
                          color: statusColour,
                          backgroundColor: `${statusColour}20`,
                        }}
                      >
                        {sched.status}
                      </span>
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
