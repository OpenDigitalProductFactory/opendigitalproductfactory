"use client";

import { useEffect, useState, useTransition } from "react";
import { semanticReviewRecoveryBudget, SEMANTIC_REVIEW_MAX_ATTEMPTS, type SemanticReviewBudgetSnapshot } from "@/lib/change-review/semantic-review-recovery-policy";
import { useRouter } from "next/navigation";
import { confirmDialog, promptDialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import {
  serverTaskrunRetry,
  serverTaskrunAbandon,
  serverTaskrunEscalate,
} from "@/lib/actions/taskrun-recovery-server-actions";

/**
 * Shared operator recovery. Native reviews resume the same bounded request;
 * generic stalled tasks retain their existing actions. Authority stays server-side.
 */
export function StalledTaskRecoveryActions({
  taskRunId,
  phase,
  nativeReview = false,
  reviewBudget,
}: {
  taskRunId: string;
  phase: string | null;
  nativeReview?: boolean;
  reviewBudget?: SemanticReviewBudgetSnapshot;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "error"; message: string } | { kind: "success"; message: string }>({ kind: "idle" });

  const isShipPhase = phase === "ship";
  const [clockTick, setClockTick] = useState(0);
  const budgetState = semanticReviewRecoveryBudget(reviewBudget?.deadlineAt, reviewBudget?.recoveryAttempt);
  const budgetTitle = {
    available: "Review awaiting recovery",
    expired: "Review window expired",
    exhausted: "Recovery limit reached",
    unknown: "Recovery availability unknown",
  }[budgetState];
  const deadline = reviewBudget?.deadlineAt ? Date.parse(reviewBudget.deadlineAt) : NaN;
  const recoveryAttempt = reviewBudget?.recoveryAttempt;
  useEffect(() => {
    if (!nativeReview || !Number.isFinite(deadline) || deadline <= Date.now()) return;
    const timer = setTimeout(() => setClockTick((tick) => tick + 1), Math.min(deadline - Date.now(), 2_147_483_647));
    return () => clearTimeout(timer);
  }, [nativeReview, deadline, clockTick]);

  const onRetry = async () => {
    if (nativeReview && semanticReviewRecoveryBudget(reviewBudget?.deadlineAt, reviewBudget?.recoveryAttempt) !== "available") {
      setClockTick((tick) => tick + 1);
      return;
    }
    if (isShipPhase || nativeReview) {
      const ok = await confirmDialog({
        title: nativeReview ? "Resume review" : "Retry ship-phase task",
        message:
          nativeReview ? "Reuse completed checks. Replace uncertain inference; another provider charge is possible. Resume?" : "Retry may double-publish. Continue?",
        tone: "danger",
        confirmLabel: "Retry",
      });
      if (!ok) return;
    }
    if (nativeReview && semanticReviewRecoveryBudget(reviewBudget?.deadlineAt, reviewBudget?.recoveryAttempt) !== "available") {
      setClockTick((tick) => tick + 1);
      return;
    }
    startTransition(async () => {
      const result = await serverTaskrunRetry(taskRunId, { force: isShipPhase || nativeReview });
      if (result.ok) {
        setStatus({ kind: "success", message: nativeReview ? "Recovery requested" : `Retried as ${result.data.newTaskRunId}` });
        router.refresh();
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  };

  const onAbandon = async () => {
    const ok = await confirmDialog({
      title: "Abandon task",
      message: "Abandon this stalled task? Live child tasks will also be canceled.",
      tone: "danger",
      confirmLabel: "Abandon",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await serverTaskrunAbandon(taskRunId);
      if (result.ok) {
        setStatus({ kind: "success", message: "Task abandoned" });
        router.refresh();
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  };

  const onEscalate = async () => {
    const notes = (await promptDialog({
      title: "Escalate task",
      message: "Optional note for the escalation:",
      confirmLabel: "Escalate",
    })) ?? undefined;
    startTransition(async () => {
      const result = await serverTaskrunEscalate(taskRunId, notes);
      if (result.ok) {
        setStatus({ kind: "success", message: "Escalated for review" });
        router.refresh();
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  };

  return (
    <div className="space-y-2">
      <p aria-live={nativeReview ? "polite" : undefined} className="text-xs font-semibold text-[var(--dpf-muted)]">
        {nativeReview ? budgetTitle : "Stalled — operator recovery"}
      </p>
      {nativeReview && <div className="space-y-1 text-xs text-[var(--dpf-muted)]">
        {Number.isFinite(deadline) && <p>Deadline: <time dateTime={new Date(deadline).toISOString()}>{new Date(deadline).toLocaleString()}</time></p>}
        {typeof recoveryAttempt === "number" && Number.isSafeInteger(recoveryAttempt) && recoveryAttempt >= 0 && <p>Recovery attempts: {recoveryAttempt} / {SEMANTIC_REVIEW_MAX_ATTEMPTS}</p>}
        <p>{budgetState === "available" ? "The original requester can confirm recovery; authority is checked again when submitted." : budgetState === "unknown" ? "Recovery limits could not be read. Inspect the request history before further action." : "This request cannot resume. Its deadline and recovery limit stay unchanged; inspect history with the requester."}</p>
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" className="min-h-11"
          type="button"
          onClick={onRetry}
          disabled={pending || (nativeReview && budgetState !== "available")}
        >
          {nativeReview ? "Resume review" : "Retry"}
        </Button>
        {!nativeReview && <Button variant="secondary" size="sm" className="min-h-11"
          type="button"
          onClick={onAbandon}
          disabled={pending}
          title="Cancel this task and live children"
        >
          Abandon
        </Button>}
        {!nativeReview && <Button variant="secondary" size="sm" className="min-h-11"
          type="button"
          onClick={onEscalate}
          disabled={pending}
          title="Park for review; notifies the accountable owner"
        >
          Escalate
        </Button>}
      </div>
      {status.kind === "success" && (
        <p role="status" className="text-xs text-[var(--dpf-accent)]">{status.message}</p>
      )}
      {status.kind === "error" && (
        <p role="alert" className="text-xs text-[var(--dpf-error)]">{status.message}</p>
      )}
    </div>
  );
}
