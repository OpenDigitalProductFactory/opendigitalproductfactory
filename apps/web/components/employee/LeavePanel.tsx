"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeavePolicyRow, LeaveBalanceRow, LeaveRequestRow } from "@/lib/leave-data";
import { submitLeaveRequest, approveLeaveRequest, rejectLeaveRequest } from "@/lib/actions/leave";

const LEAVE_COLOURS: Record<string, string> = {
  vacation: "#38bdf8",
  sick: "#fb923c",
  personal: "#a78bfa",
  parental: "#f472b6",
  unpaid: "#8888a0",
};

const STATUS_COLOURS: Record<string, string> = {
  pending: "#fbbf24",
  approved: "#4ade80",
  rejected: "#ef4444",
  cancelled: "#8888a0",
};

type Props = {
  policies: LeavePolicyRow[];
  balances: LeaveBalanceRow[];
  requests: LeaveRequestRow[];
  isManager?: boolean;
  pendingApprovals?: LeaveRequestRow[];
};

export function LeavePanel({ policies, balances, requests, isManager, pendingApprovals }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showRequest, setShowRequest] = useState(false);
  const [newRequest, setNewRequest] = useState({
    leaveType: policies[0]?.leaveType ?? "vacation",
    startDate: "",
    endDate: "",
    days: 1,
    reason: "",
  });

  function handleSubmit() {
    if (!newRequest.startDate || !newRequest.endDate) return;
    startTransition(async () => {
      await submitLeaveRequest(newRequest);
      setShowRequest(false);
      setNewRequest({ leaveType: policies[0]?.leaveType ?? "vacation", startDate: "", endDate: "", days: 1, reason: "" });
      router.refresh();
    });
  }

  function handleApprove(requestId: string) {
    startTransition(async () => {
      await approveLeaveRequest(requestId);
      router.refresh();
    });
  }

  function handleReject(requestId: string) {
    const reason = prompt("Rejection reason:");
    if (!reason) return;
    startTransition(async () => {
      await rejectLeaveRequest(requestId, reason);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* Leave Balances */}
      {balances.length > 0 && (
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Leave Balances ({new Date().getFullYear()})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {balances.map((b) => {
              const colour = LEAVE_COLOURS[b.leaveType] ?? "#8888a0";
              return (
                <div key={b.id} className="p-2 rounded border border-[var(--dpf-border)]">
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: colour }}>
                    {b.leaveType}
                  </div>
                  <div className="text-lg font-bold text-white">{b.remaining}</div>
                  <div className="text-[10px] text-[var(--dpf-muted)]">
                    of {b.allocated} days · {b.used} used
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Manager: Pending Approvals */}
      {isManager && pendingApprovals && pendingApprovals.length > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-yellow-400 mb-3">
            Pending Approvals ({pendingApprovals.length})
          </h3>
          <div className="space-y-2">
            {pendingApprovals.map((r) => (
              <div key={r.id} className="flex items-center gap-3 p-2 rounded border border-[var(--dpf-border)]">
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-white">{r.employeeName}</span>
                  <span className="text-[10px] text-[var(--dpf-muted)] ml-2">
                    {r.leaveType} · {r.days} day{r.days !== 1 ? "s" : ""} · {new Date(r.startDate).toLocaleDateString()} – {new Date(r.endDate).toLocaleDateString()}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleApprove(r.requestId)}
                  className="text-[10px] px-2 py-0.5 rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleReject(r.requestId)}
                  className="text-[10px] px-2 py-0.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Request Leave */}
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
            Leave Requests
          </h3>
          <button
            type="button"
            onClick={() => setShowRequest(!showRequest)}
            className="text-[10px] px-2 py-0.5 rounded border border-[var(--dpf-accent)]/40 text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)]/10"
          >
            + Request Leave
          </button>
        </div>

        {showRequest && (
          <div className="mb-3 p-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] space-y-2">
            <div className="flex gap-2">
              <select
                value={newRequest.leaveType}
                onChange={(e) => setNewRequest((p) => ({ ...p, leaveType: e.target.value }))}
                className="px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-white"
              >
                {policies.map((p) => (
                  <option key={p.policyId} value={p.leaveType}>{p.name}</option>
                ))}
              </select>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={newRequest.days}
                onChange={(e) => setNewRequest((p) => ({ ...p, days: parseFloat(e.target.value) || 1 }))}
                className="w-16 px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-white"
                placeholder="Days"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="date"
                value={newRequest.startDate}
                onChange={(e) => setNewRequest((p) => ({ ...p, startDate: e.target.value }))}
                className="px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-white"
              />
              <input
                type="date"
                value={newRequest.endDate}
                onChange={(e) => setNewRequest((p) => ({ ...p, endDate: e.target.value }))}
                className="px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-white"
              />
            </div>
            <input
              type="text"
              placeholder="Reason (optional)"
              value={newRequest.reason}
              onChange={(e) => setNewRequest((p) => ({ ...p, reason: e.target.value }))}
              className="w-full px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-white"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isPending || !newRequest.startDate || !newRequest.endDate}
                onClick={handleSubmit}
                className="text-[10px] px-2 py-1 rounded bg-[var(--dpf-accent)]/20 border border-[var(--dpf-accent)]/40 text-[var(--dpf-accent)] disabled:opacity-50"
              >
                Submit Request
              </button>
              <button
                type="button"
                onClick={() => setShowRequest(false)}
                className="text-[10px] px-2 py-1 rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {requests.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)]">No leave requests.</p>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => {
              const colour = STATUS_COLOURS[r.status] ?? "#8888a0";
              return (
                <div key={r.id} className="flex items-center gap-3 p-2 rounded border border-[var(--dpf-border)]">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: colour }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-white">{r.leaveType}</span>
                    <span className="text-[10px] text-[var(--dpf-muted)] ml-2">
                      {r.days} day{r.days !== 1 ? "s" : ""} · {new Date(r.startDate).toLocaleDateString()} – {new Date(r.endDate).toLocaleDateString()}
                    </span>
                  </div>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: `${colour}15`, color: colour }}
                  >
                    {r.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
