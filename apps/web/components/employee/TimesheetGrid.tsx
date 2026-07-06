"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTimesheetEntries, submitTimesheet } from "@/lib/actions/timesheet";
import type { TimesheetPeriodRow } from "@/lib/timesheet-data";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  submitted: "var(--dpf-warning)",
  approved: "var(--dpf-success)",
  rejected: "var(--dpf-error)",
};

type EntryState = {
  dayOfWeek: number;
  date: string;
  hours: number;
  breakMinutes: number;
  notes: string;
  billable: boolean;
  customerAccountId: string | null;
  billableRateId: string | null;
  billableHours: number;
  invoiceId: string | null;
};

/** Present only when the org's financial profile enables billable time. */
export type TimesheetBillingContext = {
  customers: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
};

type Props = {
  existingPeriod: TimesheetPeriodRow | null;
  weekStarting: string;
  billing?: TimesheetBillingContext | null;
};

function buildEmptyEntries(weekStarting: string): EntryState[] {
  const start = new Date(weekStarting);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return {
      dayOfWeek: i,
      date: date.toISOString().split("T")[0]!,
      hours: 0,
      breakMinutes: 0,
      notes: "",
      billable: false,
      customerAccountId: null,
      billableRateId: null,
      billableHours: 0,
      invoiceId: null,
    };
  });
}

function buildEntriesFromPeriod(period: TimesheetPeriodRow, weekStarting: string): EntryState[] {
  const empty = buildEmptyEntries(weekStarting);
  for (const entry of period.entries) {
    const idx = empty.findIndex((e) => e.dayOfWeek === entry.dayOfWeek);
    if (idx >= 0) {
      empty[idx] = {
        dayOfWeek: entry.dayOfWeek,
        date: entry.date.split("T")[0]!,
        hours: entry.hours,
        breakMinutes: entry.breakMinutes,
        notes: entry.notes ?? "",
        billable: entry.billable,
        customerAccountId: entry.customerAccountId,
        billableRateId: entry.billableRateId,
        billableHours: entry.billableHours,
        invoiceId: entry.invoiceId,
      };
    }
  }
  return empty;
}

export function TimesheetGrid({ existingPeriod, weekStarting, billing }: Props) {
  const router = useRouter();

  function navigateWeek(direction: -1 | 1) {
    const current = new Date(weekStarting);
    current.setDate(current.getDate() + direction * 7);
    const iso = current.toISOString().split("T")[0]!;
    router.push(`?view=timesheets&week=${iso}`, { scroll: false });
  }
  const [isPending, startTransition] = useTransition();
  const [entries, setEntries] = useState<EntryState[]>(
    existingPeriod ? buildEntriesFromPeriod(existingPeriod, weekStarting) : buildEmptyEntries(weekStarting),
  );
  const [notes, setNotes] = useState(existingPeriod?.notes ?? "");
  const [message, setMessage] = useState<string | null>(null);

  const isEditable = !existingPeriod || existingPeriod.status === "draft" || existingPeriod.status === "rejected";
  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
  const totalBreaks = entries.reduce((sum, e) => sum + e.breakMinutes, 0);
  const totalBillable = entries.reduce((sum, e) => sum + (e.billable ? e.billableHours : 0), 0);
  const overtimeThreshold = existingPeriod?.overtimeThreshold ?? 40;
  const overtimeHours = Math.max(0, totalHours - overtimeThreshold);
  const showBilling = Boolean(billing);

  function updateEntry(dayOfWeek: number, field: "hours" | "breakMinutes", value: number) {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.dayOfWeek !== dayOfWeek) return e;
        const next = { ...e, [field]: value };
        // Billable hours track worked hours: never above them, and follow them
        // while the two are still equal (the common "all of it" case).
        if (field === "hours" && next.billable) {
          next.billableHours = e.billableHours === e.hours ? value : Math.min(next.billableHours, value);
        }
        return next;
      }),
    );
  }

  function updateBilling(dayOfWeek: number, patch: Partial<EntryState>) {
    setEntries((prev) =>
      prev.map((e) => (e.dayOfWeek === dayOfWeek ? { ...e, ...patch } : e)),
    );
  }

  function toggleBillable(dayOfWeek: number, on: boolean) {
    setEntries((prev) =>
      prev.map((e) =>
        e.dayOfWeek === dayOfWeek
          ? { ...e, billable: on, billableHours: on ? e.hours : 0 }
          : e,
      ),
    );
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveTimesheetEntries({ weekStarting, entries, ...(notes ? { notes } : {}) });
      if (result.success) {
        setMessage("Saved");
        router.refresh();
      } else {
        setMessage(result.error ?? "Save failed");
      }
      setTimeout(() => setMessage(null), 3000);
    });
  }

  function handleSubmit() {
    if (!existingPeriod) {
      // Save first, then submit
      startTransition(async () => {
        const saveResult = await saveTimesheetEntries({ weekStarting, entries, ...(notes ? { notes } : {}) });
        if (!saveResult.success || !saveResult.periodId) {
          setMessage(saveResult.error ?? "Save failed");
          return;
        }
        const submitResult = await submitTimesheet(saveResult.periodId);
        if (submitResult.success) {
          setMessage("Submitted for approval");
          router.refresh();
        } else {
          setMessage(submitResult.error ?? "Submit failed");
        }
        setTimeout(() => setMessage(null), 3000);
      });
    } else {
      startTransition(async () => {
        const result = await submitTimesheet(existingPeriod.periodId);
        if (result.success) {
          setMessage("Submitted for approval");
          router.refresh();
        } else {
          setMessage(result.error ?? "Submit failed");
        }
        setTimeout(() => setMessage(null), 3000);
      });
    }
  }

  const weekLabel = new Date(weekStarting).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
            Timesheet
          </h3>
          {existingPeriod && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                background: `${STATUS_COLOURS[existingPeriod.status] ?? "#888"}15`,
                color: STATUS_COLOURS[existingPeriod.status] ?? "#888",
              }}
            >
              {existingPeriod.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => navigateWeek(-1)} className="text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] text-xs px-1">&larr;</button>
          <span className="text-xs text-[var(--dpf-text)] font-medium">Week of {weekLabel}</span>
          <button type="button" onClick={() => navigateWeek(1)} className="text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] text-xs px-1">&rarr;</button>
        </div>
      </div>

      {/* Rejection reason */}
      {existingPeriod?.status === "rejected" && existingPeriod.rejectionReason && (
        <div className="mb-3 p-2 rounded border border-[var(--dpf-error)]/30 bg-[var(--dpf-error)]/5 text-xs text-[var(--dpf-error)]">
          Rejected: {existingPeriod.rejectionReason}
        </div>
      )}

      {/* Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th className="text-left text-[10px] text-[var(--dpf-muted)] uppercase pb-2 w-16">Day</th>
              <th className="text-left text-[10px] text-[var(--dpf-muted)] uppercase pb-2 w-20">Date</th>
              <th className="text-center text-[10px] text-[var(--dpf-muted)] uppercase pb-2 w-20">Hours</th>
              <th className="text-center text-[10px] text-[var(--dpf-muted)] uppercase pb-2 w-24">Break (min)</th>
              {showBilling && (
                <th className="text-center text-[10px] text-[var(--dpf-muted)] uppercase pb-2 w-24">Bill to customer</th>
              )}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const isWeekend = entry.dayOfWeek >= 5;
              const isInvoiced = entry.invoiceId != null;
              const billingEditable = isEditable && !isInvoiced;
              return (
                <Fragment key={entry.dayOfWeek}>
                <tr
                  style={{ background: isWeekend ? "rgba(255,255,255,0.02)" : "transparent" }}
                >
                  <td className="py-1.5 text-[var(--dpf-text)] font-medium">{DAY_NAMES[entry.dayOfWeek]}</td>
                  <td className="py-1.5 text-[var(--dpf-muted)]">{entry.date}</td>
                  <td className="py-1.5 text-center">
                    {isEditable ? (
                      <input
                        type="number"
                        min={0}
                        max={24}
                        step={0.25}
                        value={entry.hours || ""}
                        onChange={(e) => updateEntry(entry.dayOfWeek, "hours", parseFloat(e.target.value) || 0)}
                        className="w-16 px-2 py-1 text-center text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)]"
                      />
                    ) : (
                      <span className="text-[var(--dpf-text)]">{entry.hours}</span>
                    )}
                  </td>
                  <td className="py-1.5 text-center">
                    {isEditable ? (
                      <input
                        type="number"
                        min={0}
                        max={120}
                        step={5}
                        value={entry.breakMinutes || ""}
                        onChange={(e) => updateEntry(entry.dayOfWeek, "breakMinutes", parseInt(e.target.value) || 0)}
                        className="w-16 px-2 py-1 text-center text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)]"
                      />
                    ) : (
                      <span className="text-[var(--dpf-muted)]">{entry.breakMinutes}</span>
                    )}
                  </td>
                  {showBilling && (
                    <td className="py-1.5 text-center">
                      {isInvoiced ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--dpf-success)]/10 text-[var(--dpf-success)]">
                          Invoiced
                        </span>
                      ) : billingEditable ? (
                        <input
                          type="checkbox"
                          checked={entry.billable}
                          disabled={entry.hours <= 0 && !entry.billable}
                          onChange={(e) => toggleBillable(entry.dayOfWeek, e.target.checked)}
                          aria-label={`Bill ${DAY_NAMES[entry.dayOfWeek]} to a customer`}
                        />
                      ) : (
                        <span className="text-[var(--dpf-muted)]">{entry.billable ? `${entry.billableHours}h` : "—"}</span>
                      )}
                    </td>
                  )}
                </tr>
                {showBilling && entry.billable && (
                  <tr>
                    <td />
                    <td colSpan={showBilling ? 4 : 3} className="pb-2">
                      <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1.5">
                        <select
                          value={entry.customerAccountId ?? ""}
                          disabled={!billingEditable}
                          onChange={(e) => updateBilling(entry.dayOfWeek, { customerAccountId: e.target.value || null })}
                          className="px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] max-w-40"
                          aria-label="Customer"
                        >
                          <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Customer…</option>
                          {billing!.customers.map((c) => (
                            <option key={c.id} value={c.id} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={entry.billableRateId ?? ""}
                          disabled={!billingEditable}
                          onChange={(e) => updateBilling(entry.dayOfWeek, { billableRateId: e.target.value || null })}
                          className="px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] max-w-40"
                          aria-label="Service billed as"
                        >
                          <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Service…</option>
                          {billing!.services.map((s) => (
                            <option key={s.id} value={s.id} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1 text-[10px] text-[var(--dpf-muted)]">
                          Billable hours
                          <input
                            type="number"
                            min={0}
                            max={entry.hours}
                            step={0.25}
                            value={entry.billableHours || ""}
                            disabled={!billingEditable}
                            onChange={(e) =>
                              updateBilling(entry.dayOfWeek, {
                                billableHours: Math.min(Math.max(parseFloat(e.target.value) || 0, 0), entry.hours),
                              })
                            }
                            className="w-16 px-2 py-1 text-center text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)]"
                          />
                        </label>
                        {billingEditable && (!entry.customerAccountId || !entry.billableRateId) && (
                          <span className="text-[10px] text-[var(--dpf-warning)]">
                            Choose a customer and service so these hours can be invoiced.
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--dpf-border)]">
              <td colSpan={2} className="py-2 text-[var(--dpf-text)] font-semibold">Total</td>
              <td className="py-2 text-center font-semibold text-[var(--dpf-text)]">{totalHours}h</td>
              <td className="py-2 text-center text-[var(--dpf-muted)]">{totalBreaks}m</td>
              {showBilling && (
                <td className="py-2 text-center text-[var(--dpf-text)] font-semibold">
                  {totalBillable > 0 ? `${totalBillable}h billable` : "—"}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Overtime indicator */}
      {overtimeHours > 0 && (
        <div className="mt-2 text-[11px] text-[var(--dpf-warning)] flex items-center gap-1">
          <span>&#9888;</span>
          {overtimeHours}h overtime (threshold: {overtimeThreshold}h/week)
        </div>
      )}

      {/* Notes */}
      {isEditable && (
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Weekly notes (optional)"
          rows={2}
          className="mt-3 w-full px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] resize-none"
        />
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        {isEditable && (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={handleSave}
              className="text-[11px] px-3 py-1.5 rounded border border-[var(--dpf-border)] text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50"
            >
              Save Draft
            </button>
            <button
              type="button"
              disabled={isPending || totalHours === 0}
              onClick={handleSubmit}
              className="text-[11px] px-3 py-1.5 rounded border border-[var(--dpf-accent)]/40 text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)]/10 disabled:opacity-50"
            >
              Submit for Approval
            </button>
          </>
        )}
        {message && (
          <span className={`text-[11px] ${message.includes("fail") || message.includes("Cannot") ? "text-[var(--dpf-error)]" : "text-[var(--dpf-success)]"}`}>
            {message}
          </span>
        )}
      </div>

      {/* Approved info */}
      {existingPeriod?.status === "approved" && existingPeriod.approvedByName && (
        <div className="mt-2 text-[10px] text-[var(--dpf-success)]">
          Approved by {existingPeriod.approvedByName} on {new Date(existingPeriod.approvedAt!).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
