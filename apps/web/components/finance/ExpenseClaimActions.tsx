"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { respondToExpenseApproval, markExpenseReimbursed } from "@/lib/actions/expenses";

interface Props {
  claimId: string;
  status: string;
  approvalToken: string | null;
}

export function ExpenseClaimActions({ claimId, status, approvalToken }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<"approve" | "reject" | "reimburse" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function handleApprove() {
    if (!approvalToken) return;
    setLoading("approve");
    setError(null);
    try {
      await respondToExpenseApproval(approvalToken, true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve");
    } finally {
      setLoading(null);
    }
  }

  async function handleReject() {
    if (!approvalToken) return;
    setLoading("reject");
    setError(null);
    try {
      await respondToExpenseApproval(approvalToken, false, reason || undefined);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reject");
    } finally {
      setLoading(null);
    }
  }

  async function handleReimburse() {
    setLoading("reimburse");
    setError(null);
    try {
      await markExpenseReimbursed(claimId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark as reimbursed");
    } finally {
      setLoading(null);
    }
  }

  const isDisabled = loading !== null;

  return (
    <div className="flex flex-col items-end gap-3">
      {status === "submitted" && approvalToken && (
        <>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Rejection reason (optional)"
              className="text-xs px-3 py-1.5 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)] w-56"
            />
            <button
              onClick={handleApprove}
              disabled={isDisabled}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-white transition-opacity disabled:opacity-50"
              style={{ backgroundColor: "var(--dpf-success)", color: "#000" }}
            >
              {loading === "approve" ? "Approving…" : "Approve"}
            </button>
            <button
              onClick={handleReject}
              disabled={isDisabled}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-white transition-opacity disabled:opacity-50"
              style={{ backgroundColor: "var(--dpf-error)" }}
            >
              {loading === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </div>
        </>
      )}

      {status === "approved" && (
        <button
          onClick={handleReimburse}
          disabled={isDisabled}
          className="px-3 py-1.5 rounded-md text-xs font-medium text-white transition-opacity disabled:opacity-50"
          style={{ backgroundColor: "var(--dpf-success)" }}
        >
          {loading === "reimburse" ? "Marking…" : "Mark as Reimbursed"}
        </button>
      )}

      {error && <p className="text-xs text-[var(--dpf-error)]">{error}</p>}
    </div>
  );
}
