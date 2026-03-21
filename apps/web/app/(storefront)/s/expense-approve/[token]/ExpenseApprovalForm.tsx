"use client";

import { useState } from "react";
import { respondToExpenseApproval } from "@/lib/actions/expenses";

interface Props {
  token: string;
}

export function ExpenseApprovalForm({ token }: Props) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRespond(approved: boolean) {
    setSubmitting(approved ? "approve" : "reject");
    setError(null);
    try {
      await respondToExpenseApproval(token, approved, reason || undefined);
      setDone(approved ? "approved" : "rejected");
    } catch (e) {
      setError(e instanceof Error ? e.message : "An error occurred");
    } finally {
      setSubmitting(null);
    }
  }

  if (done) {
    const isApproved = done === "approved";
    return (
      <div style={{ textAlign: "center", padding: "32px 0" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: isApproved ? "#f0fdf4" : "#fff1f2",
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 28 }}>{isApproved ? "✓" : "✗"}</span>
        </div>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: isApproved ? "#15803d" : "#be123c",
            margin: "0 0 8px",
          }}
        >
          {isApproved ? "Claim Approved" : "Claim Rejected"}
        </h2>
        <p style={{ color: "#6b7280", fontSize: 14, margin: 0 }}>
          {isApproved
            ? "Thank you. The expense claim has been approved and the employee notified."
            : "The expense claim has been rejected. The employee has been notified."}
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Reason / comments */}
      <div style={{ marginBottom: 24 }}>
        <label
          style={{
            display: "block",
            fontSize: 13,
            color: "#374151",
            marginBottom: 8,
            fontWeight: 500,
          }}
        >
          Comments / Rejection reason (optional)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Add any comments or reason for rejection…"
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid #d1d5db",
            borderRadius: 8,
            fontSize: 14,
            color: "#111827",
            resize: "vertical",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
      </div>

      {error && (
        <p style={{ color: "#be123c", fontSize: 13, marginBottom: 16 }}>{error}</p>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 12 }}>
        <button
          onClick={() => handleRespond(true)}
          disabled={submitting !== null}
          style={{
            flex: 1,
            padding: "16px 24px",
            background: submitting !== null ? "#86efac" : "#22c55e",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontSize: 16,
            fontWeight: 600,
            cursor: submitting !== null ? "not-allowed" : "pointer",
            transition: "background 0.15s",
          }}
        >
          {submitting === "approve" ? "Approving…" : "Approve"}
        </button>
        <button
          onClick={() => handleRespond(false)}
          disabled={submitting !== null}
          style={{
            flex: 1,
            padding: "16px 24px",
            background: submitting !== null ? "#fca5a5" : "#ef4444",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontSize: 16,
            fontWeight: 600,
            cursor: submitting !== null ? "not-allowed" : "pointer",
            transition: "background 0.15s",
          }}
        >
          {submitting === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
    </div>
  );
}
