"use client";

// BI-4E192035 — a leave.decide proposal is the time-off advisor's
// recommendation, not an action to "approve". The generic Approve / Reject
// verbs were ambiguous (approving a "deny" recommendation approved the leave),
// so this card shows the recommendation and asks the manager for the leave
// outcome itself. Both buttons call the same governed leave actions LeavePanel
// uses; the server refuses the generic proposal verbs for leave.decide.

import { useState, useTransition } from "react";
import { approveLeaveRequest, rejectLeaveRequest } from "@/lib/actions/leave";
import { promptDialog } from "@/components/ui/Dialog";
import { parseLeaveDecisionProposalParameters } from "@/lib/workforce/leave/leave-decision-proposal-contract";
import { useT } from "@/lib/i18n/use-t";

type Props = {
  status: string;
  parameters: Record<string, unknown>;
};

const RECOMMENDATION_COLOR = {
  approve: "var(--dpf-success)",
  deny: "var(--dpf-error)",
  escalate: "var(--dpf-warning)",
} as const;

export function LeaveDecisionProposalCard({ status, parameters }: Props) {
  const t = useT("approvals");
  const parsed = parseLeaveDecisionProposalParameters(parameters);
  const [outcome, setOutcome] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!parsed) {
    return (
      <div style={{ color: "var(--dpf-muted)", fontSize: 11 }}>
        {t("leaveDecision.unreadable")}
      </div>
    );
  }

  const settled =
    outcome ?? (status === "executed" ? "approved" : status === "rejected" ? "denied" : null);
  const isOpen = status === "proposed" && !outcome;

  const approve = () => {
    setError(null);
    startTransition(async () => {
      const result = await approveLeaveRequest(parsed.requestId);
      if (result.success) setOutcome("approved");
      else setError(result.error ?? t("leaveDecision.approveFailed"));
    });
  };

  const deny = async () => {
    setError(null);
    const reason = await promptDialog({
      title: t("leaveDecision.denyTitle"),
      message: t("leaveDecision.denyReasonPrompt"),
      required: true,
      confirmLabel: t("leaveDecision.denyLeave"),
      tone: "danger",
    });
    if (!reason) return;
    startTransition(async () => {
      const result = await rejectLeaveRequest(parsed.requestId, reason);
      if (result.success) setOutcome("denied");
      else setError(result.error ?? t("leaveDecision.denyFailed"));
    });
  };

  const buttonBase = {
    flex: 1,
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 11,
    cursor: pending ? "not-allowed" : "pointer",
    opacity: pending ? 0.6 : 1,
  } as const;

  return (
    <div data-testid="leave-decision-proposal">
      <div style={{ fontWeight: 600, color: "var(--dpf-text)", marginBottom: 6 }}>
        {t("leaveDecision.title", { requestId: parsed.requestId })}
      </div>
      <div style={{ fontSize: 11, marginBottom: 6, color: "var(--dpf-text)" }}>
        {t("leaveDecision.recommends")}{" "}
        <span style={{ fontWeight: 600, color: RECOMMENDATION_COLOR[parsed.recommendation] }}>
          {t(`leaveDecision.recommendation.${parsed.recommendation}`)}
        </span>
      </div>
      {parsed.rationale ? (
        <div style={{ color: "var(--dpf-muted)", fontSize: 11, marginBottom: 6, lineHeight: 1.5 }}>
          {parsed.rationale}
        </div>
      ) : null}
      {parsed.guardReasons.map((reason) => (
        <div key={reason} style={{ color: "var(--dpf-warning)", fontSize: 11, marginBottom: 4 }}>
          {reason}
        </div>
      ))}
      {isOpen ? (
        <>
          <div style={{ color: "var(--dpf-muted)", fontSize: 10, margin: "6px 0" }}>
            {t("leaveDecision.yourDecision")}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              disabled={pending}
              onClick={approve}
              style={{
                ...buttonBase,
                background: "color-mix(in srgb, var(--dpf-success) 20%, transparent)",
                border: "1px solid color-mix(in srgb, var(--dpf-success) 40%, transparent)",
                color: "var(--dpf-success)",
              }}
            >
              {t("leaveDecision.approveLeave")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void deny()}
              style={{
                ...buttonBase,
                background: "color-mix(in srgb, var(--dpf-error) 15%, transparent)",
                border: "1px solid color-mix(in srgb, var(--dpf-error) 30%, transparent)",
                color: "var(--dpf-error)",
              }}
            >
              {t("leaveDecision.denyLeave")}
            </button>
          </div>
        </>
      ) : null}
      {settled ? (
        <div
          role="status"
          style={{
            color: settled === "approved" ? "var(--dpf-success)" : "var(--dpf-error)",
            fontSize: 11,
            marginTop: 6,
          }}
        >
          {settled === "approved" ? t("leaveDecision.approved") : t("leaveDecision.denied")}
        </div>
      ) : null}
      {error ? (
        <div role="alert" style={{ color: "var(--dpf-error)", fontSize: 11, marginTop: 6 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
