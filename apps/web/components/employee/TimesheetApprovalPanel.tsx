"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveTimesheet, rejectTimesheet } from "@/lib/actions/timesheet";
import type { TimesheetPeriodRow } from "@/lib/timesheet-data";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Props = {
  pendingTimesheets: TimesheetPeriodRow[];
};

export function TimesheetApprovalPanel({ pendingTimesheets }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  if (pendingTimesheets.length === 0) return null;

  function handleApprove(periodId: string) {
    startTransition(async () => {
      await approveTimesheet(periodId);
      router.refresh();
    });
  }

  function handleReject(periodId: string) {
    const reason = prompt("Rejection reason:");
    if (!reason) return;
    startTransition(async () => {
      await rejectTimesheet(periodId, reason);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 mb-4">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-yellow-400 mb-3">
        Pending Timesheet Approvals ({pendingTimesheets.length})
      </h3>
      <div className="space-y-3">
        {pendingTimesheets.map((ts) => (
          <div key={ts.id} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-xs text-[var(--dpf-text)] font-medium">{ts.employeeName}</span>
                <span className="text-[10px] text-[var(--dpf-muted)] ml-2">
                  Week of {new Date(ts.weekStarting).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--dpf-text)] font-semibold">{ts.totalHours}h</span>
                {ts.overtimeHours > 0 && (
                  <span className="text-[10px] text-yellow-400">{ts.overtimeHours}h OT</span>
                )}
              </div>
            </div>

            {/* Mini daily breakdown */}
            <div className="flex gap-1 mb-2">
              {DAY_NAMES.map((day, i) => {
                const entry = ts.entries.find((e) => e.dayOfWeek === i);
                return (
                  <div key={i} className="flex-1 text-center">
                    <div className="text-[9px] text-[var(--dpf-muted)]">{day}</div>
                    <div className="text-[11px] text-[var(--dpf-text)]">{entry?.hours ?? 0}</div>
                  </div>
                );
              })}
            </div>

            {ts.notes && (
              <p className="text-[10px] text-[var(--dpf-muted)] mb-2 italic">{ts.notes}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleApprove(ts.periodId)}
                className="text-[10px] px-2.5 py-1 rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleReject(ts.periodId)}
                className="text-[10px] px-2.5 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
