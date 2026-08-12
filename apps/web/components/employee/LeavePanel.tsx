"use client";

import { useState, useTransition } from "react";
import { promptDialog } from "@/components/ui/Dialog";
import { useRouter } from "next/navigation";
import type { LeavePolicyRow, LeaveBalanceRow, LeaveRequestRow } from "@/lib/leave-data";
import { submitLeaveRequest, approveLeaveRequest, rejectLeaveRequest } from "@/lib/actions/leave";
import { DatePicker } from "@/components/ui/DatePicker";
import { StatusBadge, type Intent } from "@/components/ui/report-kit";

const LEAVE_COLOURS: Record<string, string> = {
  vacation: "var(--dpf-info)",
  sick: "var(--dpf-warning)",
  personal: "var(--dpf-accent)",
  parental: "var(--dpf-accent)",
  unpaid: "var(--dpf-muted)",
};

const RECOMMENDATION_INTENT: Record<NonNullable<LeaveRequestRow["decisionRecommendation"]>, Intent> = {
  approve: "success",
  deny: "danger",
  escalate: "warning",
};

type Props = {
  policies: LeavePolicyRow[];
  balances: LeaveBalanceRow[];
  requests: LeaveRequestRow[];
  canRequest?: boolean;
  isManager?: boolean;
  pendingApprovals?: LeaveRequestRow[];
};

function DecisionRecommendation({ request }: { request: LeaveRequestRow }) {
  const recommendation = request.decisionRecommendation;
  if (!recommendation) return null;
  return (
    <div className="mt-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--dpf-text)]">Advisor recommends</span>
        <StatusBadge intent={RECOMMENDATION_INTENT[recommendation]} label={recommendation} variant="soft" uppercase={false} />
        <span className="text-dpf-caption text-[var(--dpf-muted)]">Human decision</span>
      </div>
      {request.decisionRationale ? (
        <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">{request.decisionRationale}</p>
      ) : null}
      {request.decisionGuardReasons.map((reason) => (
        <p key={reason} className="mt-1 text-xs leading-5 text-[var(--dpf-warning)]">{reason}</p>
      ))}
    </div>
  );
}

export function LeavePanel({ policies, balances, requests, canRequest = true, isManager, pendingApprovals }: Props) {
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

  async function handleReject(requestId: string) {
    const reason = await promptDialog({
      title: "Reject leave request",
      message: "Rejection reason:",
      required: true,
      confirmLabel: "Reject",
    });
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
            Balances ({new Date().getFullYear()})
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {balances.map((b) => {
              const colour = LEAVE_COLOURS[b.leaveType] ?? "var(--dpf-muted)";
              return (
                <div key={b.id} className="p-2 rounded border border-[var(--dpf-border)]">
                  <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: colour }}>
                    {b.leaveType}
                  </div>
                  <div className="text-lg font-bold text-[var(--dpf-text)]">{b.remaining}</div>
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
        <div className="rounded-lg border border-[var(--dpf-warning)]/30 bg-[var(--dpf-warning)]/5 p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--dpf-warning)]">
            Needs review ({pendingApprovals.length})
          </h3>
          <div className="space-y-2">
            {pendingApprovals.map((r) => (
              <div key={r.id} className="rounded border border-[var(--dpf-border)] p-3" aria-busy={isPending}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                  <span className="text-xs text-[var(--dpf-text)]">{r.employeeName}</span>
                  <span className="ml-2 text-dpf-caption text-[var(--dpf-muted)]">
                    {r.leaveType} · {r.days} day{r.days !== 1 ? "s" : ""} · {new Date(r.startDate).toLocaleDateString()} – {new Date(r.endDate).toLocaleDateString()}
                  </span>
                  </div>
                  <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleApprove(r.requestId)}
                  className="min-h-8 rounded border border-[var(--dpf-success)]/30 px-3 text-xs font-medium text-[var(--dpf-success)] hover:bg-[var(--dpf-success)]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-focus)] disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleReject(r.requestId)}
                  className="min-h-8 rounded border border-[var(--dpf-error)]/30 px-3 text-xs font-medium text-[var(--dpf-error)] hover:bg-[var(--dpf-error)]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-focus)] disabled:opacity-50"
                >
                  Reject
                </button>
                </div>
                <DecisionRecommendation request={r} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Request Leave */}
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
            Requests
          </h3>
          {canRequest ? (
            <button
              type="button"
              onClick={() => setShowRequest(!showRequest)}
              className="min-h-8 rounded border border-[var(--dpf-accent)]/40 px-3 text-xs font-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent)]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-focus)]"
            >
              Request time off
            </button>
          ) : null}
        </div>

        {showRequest && (
          <div className="mb-3 p-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] space-y-2">
            <div className="flex gap-2">
              <select
                value={newRequest.leaveType}
                onChange={(e) => setNewRequest((p) => ({ ...p, leaveType: e.target.value }))}
                className="px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)]"
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
                className="w-16 px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)]"
                placeholder="Days"
              />
            </div>
            <div className="flex gap-2">
              <DatePicker
                value={newRequest.startDate ? new Date(newRequest.startDate) : null}
                onChange={(d) => setNewRequest((p) => ({ ...p, startDate: d ? d.toISOString().slice(0, 10) : "" }))}
                placeholder="Start date"
              />
              <DatePicker
                value={newRequest.endDate ? new Date(newRequest.endDate) : null}
                onChange={(d) => setNewRequest((p) => ({ ...p, endDate: d ? d.toISOString().slice(0, 10) : "" }))}
                placeholder="End date"
              />
            </div>
            <input
              type="text"
              placeholder="Reason"
              value={newRequest.reason}
              onChange={(e) => setNewRequest((p) => ({ ...p, reason: e.target.value }))}
              className="w-full px-2 py-1 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] text-[var(--dpf-text)]"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isPending || !newRequest.startDate || !newRequest.endDate}
                onClick={handleSubmit}
                className="min-h-8 rounded border border-[var(--dpf-accent)]/40 bg-[var(--dpf-accent)]/20 px-3 text-xs font-medium text-[var(--dpf-accent)] disabled:opacity-50"
              >
                {isPending ? "Submitting…" : "Submit"}
              </button>
              <button
                type="button"
                onClick={() => setShowRequest(false)}
                className="min-h-8 rounded border border-[var(--dpf-border)] px-3 text-xs text-[var(--dpf-muted)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {requests.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)]">
            {canRequest ? "No requests." : "Link an employee profile to request time off."}
          </p>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => {
              return (
                <div key={r.id} className="rounded border border-[var(--dpf-border)] p-3">
                  <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-xs text-[var(--dpf-text)]">{r.leaveType}</span>
                    <span className="ml-2 text-dpf-caption text-[var(--dpf-muted)]">
                      {r.days} day{r.days !== 1 ? "s" : ""} · {new Date(r.startDate).toLocaleDateString()} – {new Date(r.endDate).toLocaleDateString()}
                    </span>
                  </div>
                  <StatusBadge domain="leaveRequest" status={r.status} label={r.status} variant="soft" uppercase={false} />
                  </div>
                  <DecisionRecommendation request={r} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
