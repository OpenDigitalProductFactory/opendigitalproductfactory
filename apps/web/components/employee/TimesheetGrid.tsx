"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTimesheetEntries, submitTimesheet } from "@/lib/actions/timesheet";
import type { TimesheetPeriodRow } from "@/lib/timesheet-data";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_COLOURS: Record<string, string> = {
  draft: "#8888a0",
  submitted: "#fbbf24",
  approved: "#4ade80",
  rejected: "#ef4444",
};

type EntryState = {
  dayOfWeek: number;
  date: string;
  hours: number;
  breakMinutes: number;
  notes: string;
};

type Props = {
  existingPeriod: TimesheetPeriodRow | null;
  weekStarting: string;
  onWeekChange: (direction: -1 | 1) => void;
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
      };
    }
  }
  return empty;
}

export function TimesheetGrid({ existingPeriod, weekStarting, onWeekChange }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [entries, setEntries] = useState<EntryState[]>(
    existingPeriod ? buildEntriesFromPeriod(existingPeriod, weekStarting) : buildEmptyEntries(weekStarting),
  );
  const [notes, setNotes] = useState(existingPeriod?.notes ?? "");
  const [message, setMessage] = useState<string | null>(null);

  const isEditable = !existingPeriod || existingPeriod.status === "draft" || existingPeriod.status === "rejected";
  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
  const totalBreaks = entries.reduce((sum, e) => sum + e.breakMinutes, 0);
  const overtimeThreshold = existingPeriod?.overtimeThreshold ?? 40;
  const overtimeHours = Math.max(0, totalHours - overtimeThreshold);

  function updateEntry(dayOfWeek: number, field: "hours" | "breakMinutes", value: number) {
    setEntries((prev) =>
      prev.map((e) => (e.dayOfWeek === dayOfWeek ? { ...e, [field]: value } : e)),
    );
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveTimesheetEntries({ weekStarting, entries, notes: notes || undefined });
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
        const saveResult = await saveTimesheetEntries({ weekStarting, entries, notes: notes || undefined });
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
          <button type="button" onClick={() => onWeekChange(-1)} className="text-[var(--dpf-muted)] hover:text-white text-xs px-1">&larr;</button>
          <span className="text-xs text-white font-medium">Week of {weekLabel}</span>
          <button type="button" onClick={() => onWeekChange(1)} className="text-[var(--dpf-muted)] hover:text-white text-xs px-1">&rarr;</button>
        </div>
      </div>

      {/* Rejection reason */}
      {existingPeriod?.status === "rejected" && existingPeriod.rejectionReason && (
        <div className="mb-3 p-2 rounded border border-red-500/30 bg-red-500/5 text-xs text-red-400">
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
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const isWeekend = entry.dayOfWeek >= 5;
              return (
                <tr
                  key={entry.dayOfWeek}
                  style={{ background: isWeekend ? "rgba(255,255,255,0.02)" : "transparent" }}
                >
                  <td className="py-1.5 text-white font-medium">{DAY_NAMES[entry.dayOfWeek]}</td>
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
                        className="w-16 px-2 py-1 text-center text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-white"
                      />
                    ) : (
                      <span className="text-white">{entry.hours}</span>
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
                        className="w-16 px-2 py-1 text-center text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-white"
                      />
                    ) : (
                      <span className="text-[var(--dpf-muted)]">{entry.breakMinutes}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-[var(--dpf-border)]">
              <td colSpan={2} className="py-2 text-white font-semibold">Total</td>
              <td className="py-2 text-center font-semibold text-white">{totalHours}h</td>
              <td className="py-2 text-center text-[var(--dpf-muted)]">{totalBreaks}m</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Overtime indicator */}
      {overtimeHours > 0 && (
        <div className="mt-2 text-[11px] text-yellow-400 flex items-center gap-1">
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
          className="mt-3 w-full px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-white placeholder:text-[var(--dpf-muted)] resize-none"
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
              className="text-[11px] px-3 py-1.5 rounded border border-[var(--dpf-border)] text-white hover:bg-[var(--dpf-surface-2)] disabled:opacity-50"
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
          <span className={`text-[11px] ${message.includes("fail") || message.includes("Cannot") ? "text-red-400" : "text-green-400"}`}>
            {message}
          </span>
        )}
      </div>

      {/* Approved info */}
      {existingPeriod?.status === "approved" && existingPeriod.approvedByName && (
        <div className="mt-2 text-[10px] text-green-400">
          Approved by {existingPeriod.approvedByName} on {new Date(existingPeriod.approvedAt!).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
