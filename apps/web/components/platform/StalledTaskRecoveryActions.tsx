"use client";

import { useState, useTransition } from "react";
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
}: {
  taskRunId: string;
  phase: string | null;
  nativeReview?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "error"; message: string } | { kind: "success"; message: string }>({ kind: "idle" });

  const isShipPhase = phase === "ship";

  const onRetry = async () => {
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
      <p className="text-xs font-semibold text-[var(--dpf-muted)]">
        {nativeReview ? "Review awaiting recovery" : "Stalled — operator recovery"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" className="min-h-11"
          type="button"
          onClick={onRetry}
          disabled={pending}
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
