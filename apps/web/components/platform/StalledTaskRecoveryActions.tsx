"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmDialog, promptDialog } from "@/components/ui/Dialog";
import {
  serverTaskrunRetry,
  serverTaskrunAbandon,
  serverTaskrunEscalate,
} from "@/lib/actions/taskrun-recovery-server-actions";

/**
 * Recovery actions for a stalled TaskRun (BI-4ab6be39 Phase F).
 *
 * Renders three buttons — Retry / Abandon / Escalate — that call the
 * server actions in lib/actions/taskrun-recovery-server-actions.ts.
 *
 * Ship-phase Retry is gated behind a confirm dialog per spec §5.5 — the
 * caller passes `phase`; this component decides the disabled/confirm UX.
 */
export function StalledTaskRecoveryActions({
  taskRunId,
  phase,
}: {
  taskRunId: string;
  phase: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: "idle" } | { kind: "error"; message: string } | { kind: "success"; message: string }>({ kind: "idle" });

  const isShipPhase = phase === "ship";

  const onRetry = async () => {
    if (isShipPhase) {
      const ok = await confirmDialog({
        title: "Retry ship-phase task",
        message:
          "Ship-phase Retry can double-publish (resend emails, re-deploy, etc.). Are you sure you want to retry?",
        tone: "danger",
        confirmLabel: "Retry",
      });
      if (!ok) return;
    }
    startTransition(async () => {
      const result = await serverTaskrunRetry(taskRunId, { force: isShipPhase });
      if (result.ok) {
        setStatus({ kind: "success", message: `Retried as ${result.data.newTaskRunId}` });
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
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
        Stalled — operator recovery
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetry}
          disabled={pending}
          className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-accent)] hover:text-white disabled:opacity-50"
          title={isShipPhase ? "Ship-phase Retry requires confirm (double-publish risk)" : "Spawn a sibling TaskRun and re-dispatch"}
        >
          Retry{isShipPhase ? " (ship)" : ""}
        </button>
        <button
          type="button"
          onClick={onAbandon}
          disabled={pending}
          className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-error)] hover:text-white disabled:opacity-50"
          title="Cancel this task and live children"
        >
          Abandon
        </button>
        <button
          type="button"
          onClick={onEscalate}
          disabled={pending}
          className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-warning)] hover:text-white disabled:opacity-50"
          title="Park for review; notifies the accountable owner"
        >
          Escalate
        </button>
      </div>
      {status.kind === "success" && (
        <p className="text-xs text-[var(--dpf-accent)]">{status.message}</p>
      )}
      {status.kind === "error" && (
        <p className="text-xs text-[var(--dpf-error)]">{status.message}</p>
      )}
    </div>
  );
}
