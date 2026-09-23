"use client";

import { ButtonLink } from "@/components/ui/Button";
import { StalledTaskRecoveryActions } from "@/components/platform/StalledTaskRecoveryActions";
import { useSemanticReviewRecoveryBudget } from "@/components/platform/useSemanticReviewRecoveryBudget";
import { semanticReviewActionLabel, semanticReviewReasonLabel, semanticReviewRecoveryPresentation } from "@/lib/change-review/semantic-review-presentation";
import type { ReviewerExecutionObservation } from "@/lib/work-management/semantic-review-room-projection";

/** Same task facts and recovery action as Operations Map, scoped to this room. */
export function ReviewerExecutionList({ runs }: { runs: readonly ReviewerExecutionObservation[] }) {
  if (!runs.length) return null;
  return <section aria-label="Reviewer executions" className="space-y-2">
    <h4 className="font-medium">Reviewer executions</h4>
    <p>Task state does not verify the Workroom outcome.</p>
    <ul className="space-y-2">{runs.map(run => <ReviewerExecutionItem key={run.taskRunId} run={run} />)}</ul>
  </section>;
}

function ReviewerExecutionItem({ run }: { run: ReviewerExecutionObservation }) {
  const { budgetState } = useSemanticReviewRecoveryBudget(run.budget, run.recoveryWait);
  const historical = run.identityScope === "historical";
  const identity = run.identityScope === "current" ? "Current request" : historical ? "Historical request" : "Version unknown";
  const next = historical ? "Inspect the current request; this history remains available."
    : run.recoveryWait ? semanticReviewRecoveryPresentation(budgetState).nextAction : semanticReviewActionLabel(run.nextAction);
  return <li>
      <details className="rounded border border-[var(--dpf-border)] p-3">
        <summary className="min-h-11 cursor-pointer break-words py-2">{run.taskRunId} · {run.status} · {identity}</summary>
        <dl className="grid gap-3 break-words sm:grid-cols-2">
          <div><dt className="font-medium">Where are we?</dt><dd>Recorded {run.status}. Heartbeat {run.heartbeat}: {run.lastHeartbeatAt ?? "unknown"}. Read at {run.readAt}.</dd></div>
          <div><dt className="font-medium">Why are we here?</dt><dd>{semanticReviewReasonLabel(run.reason)}</dd></div>
          <div><dt className="font-medium">What can happen next?</dt><dd aria-live="polite" aria-atomic="true">{next}</dd></div>
          <div><dt className="font-medium">Who owns the action?</dt><dd>{run.recoveryWait ? "Requester" : "Request owner"}: {run.requesterName ?? run.requesterId ?? "unknown"}. The server owns dispatch.</dd></div>
          <div><dt className="font-medium">What evidence supports this?</dt><dd>
            <p>TaskRun:{run.recordId} · Source: {run.sourceHeadSha ?? "unknown"}</p>
            {run.receipt ? <p>Review {run.receipt.decision}: {run.receipt.summary} · Receipt:{run.receipt.id}</p> : <p>No correlated receipt.</p>}
            <ButtonLink variant="ghost" className="min-h-11" href={`/api/internal/tasks/${encodeURIComponent(run.taskRunId)}`}>Request history</ButtonLink>
          </dd></div>
          <div><dt className="font-medium">What else is affected?</dt><dd>Linked to this Workroom. Downstream impact is not established.</dd></div>
        </dl>
        {run.checkpoints.length > 0 ? <div className="mt-3 space-y-2">
          <p>Checkpoint status is not a verified verdict. Branches run concurrently.</p>
          <ul className="space-y-2">{run.checkpoints.map(checkpoint => <li key={checkpoint.taskNodeId} className="break-words rounded border border-[var(--dpf-border)] p-2">
            <p>{checkpoint.title} · {checkpoint.status}</p>
            <p className="text-[var(--dpf-muted)]">{checkpoint.actorId ?? "Actor unknown"} · {checkpoint.taskNodeId} · TaskNode:{checkpoint.recordId}</p>
          </li>)}</ul>
        </div> : <p className="mt-3">No checkpoint observations available.</p>}
        {run.recoveryWait && !historical ? <StalledTaskRecoveryActions taskRunId={run.taskRunId} phase={null} nativeReview reviewBudget={run.budget} /> : null}
      </details>
    </li>;
}
