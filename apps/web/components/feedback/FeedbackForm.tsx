"use client";

import { useState } from "react";
import type { FeedbackAutoFilePolicy, FeedbackTriggerKind } from "@/lib/feedback/feedback-event";
import { submitReport } from "@/lib/quality-queue";
import { useAsyncAction } from "@/lib/shared/use-save-state";
import { SaveStateIndicator } from "@/components/ui/SaveStateIndicator";
import { UpstreamEscalation } from "./UpstreamEscalation";

type Props = {
  routeContext: string;
  userId?: string | null;
  errorMessage?: string;
  errorStack?: string;
  source?: string;
  triggerKind?: FeedbackTriggerKind;
  supportSessionId?: string;
  autoFilePolicy?: FeedbackAutoFilePolicy;
  onClose?: () => void;
};

export function FeedbackForm({
  routeContext,
  userId,
  errorMessage,
  errorStack,
  source,
  triggerKind,
  supportSessionId,
  autoFilePolicy,
  onClose,
}: Props) {
  const [type, setType] = useState<string>(errorMessage ? "runtime_error" : "user_report");
  const [description, setDescription] = useState(errorMessage ?? "");
  const [submitted, setSubmitted] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  // BI-20716EA4: submitReport itself already falls back to a local offline
  // queue on a fetch failure (see lib/operate/quality-queue.ts), so an
  // `{ ok: false }` result there is a soft "queued" outcome, not a defect —
  // that business distinction stays local (reportId/queued state below). What
  // WAS missing is any handling for submitReport rejecting outright (e.g. the
  // offline-queue write itself throwing) and any visible pending/in-flight
  // state — both now come from the shared save-state primitive: a genuine
  // rejection surfaces as "failed" with a plain-language Retry that re-sends
  // the same typed report (nothing the owner typed is lost), and the Submit
  // button disables + relabels while a submit is in flight.
  type ReportInput = Parameters<typeof submitReport>[0];
  const submitAction = useAsyncAction<ReportInput>(async (input) => {
    const result = await submitReport(input);
    if (result.ok && result.reportId) {
      setReportId(result.reportId);
    } else {
      setQueued(true);
    }
    setSubmitted(true);
    return { ok: true };
  });

  function handleSubmit() {
    submitAction.run({
      type,
      title: description.slice(0, 100) || "User report",
      description,
      severity: type === "runtime_error" ? "high" : "medium",
      routeContext,
      ...(errorStack !== undefined && { errorStack }),
      source: source ?? "manual",
      ...(userId != null && { userId }),
      ...(triggerKind !== undefined && { triggerKind }),
      ...(supportSessionId !== undefined && { supportSessionId }),
      ...(autoFilePolicy !== undefined && { autoFilePolicy }),
    });
  }

  if (submitted) {
    return (
      <div className="p-4 text-center text-sm text-[var(--dpf-text)]">
        {reportId
          ? `Thanks! Report ${reportId} filed. The platform team has been notified.`
          : queued
            ? "Saved — will be sent when connectivity is restored."
            : "Saved — will be sent when connectivity is restored."}
        {reportId && <UpstreamEscalation reportId={reportId} />}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mx-auto mt-3 block rounded-md border border-[var(--dpf-border)] px-3 py-1 text-xs text-[var(--dpf-text)]"
          >
            Close
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 text-sm text-[var(--dpf-text)]">
      <div className="mb-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1.5 text-xs text-[var(--dpf-text)]"
        >
          <option value="runtime_error">Bug Report</option>
          <option value="feedback">Suggestion</option>
          <option value="user_report">Question</option>
        </select>
      </div>
      <div className="mb-2">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what happened or what you'd like to see..."
          rows={4}
          className="w-full resize-y rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1.5 text-xs text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)]"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!description.trim() || submitAction.status === "pending"}
          aria-busy={submitAction.status === "pending"}
          className="flex-1 rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitAction.status === "pending" ? "Submitting…" : "Submit"}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-text)]"
          >
            Cancel
          </button>
        )}
      </div>
      {submitAction.status === "failed" && (
        <div className="mt-2">
          <SaveStateIndicator
            status={submitAction.status}
            error={submitAction.error}
            onRetry={handleSubmit}
          />
        </div>
      )}
    </div>
  );
}

