// apps/web/app/(shell)/finance/recurring/[id]/page.tsx
import { getRecurringSchedule } from "@/lib/actions/recurring";
import { ScheduleStatusButtons } from "@/components/finance/ScheduleStatusButtons";
import Link from "next/link";
import { notFound } from "next/navigation";

const SCHEDULE_STATUS_COLOURS: Record<string, string> = {
  active: "#4ade80",
  paused: "#fbbf24",
  cancelled: "#ef4444",
  completed: "#8888a0",
};

const INVOICE_STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  sent: "#38bdf8",
  viewed: "#a78bfa",
  overdue: "#ef4444",
  partially_paid: "#fbbf24",
  paid: "#4ade80",
  void: "#6b7280",
};

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

type Props = { params: Promise<{ id: string }> };

export default async function RecurringDetailPage({ params }: Props) {
  const { id } = await params;

  const schedule = await getRecurringSchedule(id);
  if (!schedule) notFound();

  const statusColour = SCHEDULE_STATUS_COLOURS[schedule.status] ?? "#6b7280";
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
        <Link
          href="/finance/recurring"
          className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
        >
          Recurring
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{schedule.name}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-[var(--dpf-text)]">
              {schedule.name}
            </h1>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full"
              style={{
                color: statusColour,
                backgroundColor: `${statusColour}20`,
              }}
            >
              {schedule.status}
            </span>
          </div>
          <p className="text-sm text-[var(--dpf-muted)]">
            {schedule.account.name}
          </p>
          <div className="mt-3">
            <ScheduleStatusButtons
              scheduleId={schedule.id}
              currentStatus={schedule.status}
            />
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-[var(--dpf-text)]">
            {schedule.currency}{" "}
            {formatMoney(Number(schedule.amount))}
          </p>
          <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5">
            {FREQUENCY_LABELS[schedule.frequency] ?? schedule.frequency}
          </p>
        </div>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Start Date</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">
            {new Date(schedule.startDate).toLocaleDateString("en-GB")}
          </p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">End Date</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">
            {schedule.endDate
              ? new Date(schedule.endDate).toLocaleDateString("en-GB")
              : "Ongoing"}
          </p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Next Invoice</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">
            {new Date(schedule.nextInvoiceDate).toLocaleDateString("en-GB")}
          </p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Auto-Send</p>
          <p
            className="text-sm font-semibold"
            style={{ color: schedule.autoSend ? "#4ade80" : "#8888a0" }}
          >
            {schedule.autoSend ? "Enabled" : "Disabled"}
          </p>
        </div>
      </div>

      {/* Template notes */}
      {schedule.templateNotes && (
        <section className="mb-6">
          <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">
            Template Notes
          </h2>
          <p className="text-sm text-[var(--dpf-text)] whitespace-pre-wrap">
            {schedule.templateNotes}
          </p>
        </section>
      )}

      {/* Line items */}
      <section className="mb-6">
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Line Items
        </h2>
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Description
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Qty
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Unit Price
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Tax %
                </th>
              </tr>
            </thead>
            <tbody>
              {schedule.lineItems.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-[var(--dpf-border)] last:border-0"
                >
                  <td className="px-4 py-2.5 text-[var(--dpf-text)]">
                    {item.description}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                    {Number(item.quantity)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                    {schedule.currency} {formatMoney(Number(item.unitPrice))}
                  </td>
                  <td className="px-4 py-2.5 text-right text-[var(--dpf-muted)]">
                    {Number(item.taxRate)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Generated invoices */}
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Generated Invoices
        </h2>
        {schedule.generatedInvoices.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">
            No invoices generated yet.
          </p>
        ) : (
          <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--dpf-border)]">
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Ref
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Issue Date
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Due Date
                  </th>
                  <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Status
                  </th>
                  <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedule.generatedInvoices.map((inv) => {
                  const invColour =
                    INVOICE_STATUS_COLOURS[inv.status] ?? "#6b7280";
                  return (
                    <tr
                      key={inv.id}
                      className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/finance/invoices/${inv.id}`}
                          className="text-[9px] font-mono text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
                        >
                          {inv.invoiceRef}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                        {new Date(inv.issueDate).toLocaleDateString("en-GB")}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--dpf-muted)]">
                        {new Date(inv.dueDate).toLocaleDateString("en-GB")}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{
                            color: invColour,
                            backgroundColor: `${invColour}20`,
                          }}
                        >
                          {inv.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[var(--dpf-text)]">
                        {schedule.currency}{" "}
                        {formatMoney(Number(inv.totalAmount))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
