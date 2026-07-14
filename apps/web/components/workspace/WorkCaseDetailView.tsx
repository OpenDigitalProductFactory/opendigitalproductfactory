import { ArrowLeft, Clock, FileText, ShieldCheck } from "lucide-react";

import { LocalTime } from "@/components/ui/LocalTime";
import { WorkItemCommentThread } from "@/components/workspace/WorkItemCommentThread";
import { StatusBadge } from "@/components/ui/report-kit";
import type { Intent } from "@/components/ui/report-kit/statusColors";
import type { WorkspaceWorkCaseDetailView } from "@/lib/work-management/workspace-case-loader";

type Props = {
  detail: WorkspaceWorkCaseDetailView;
};

const STATE_INTENT: Record<string, Intent> = {
  intake: "neutral",
  triage: "info",
  active: "accent",
  "waiting-on-person": "warning",
  "waiting-on-system": "danger",
  "awaiting-decision": "warning",
  verifying: "info",
  resolved: "success",
  closed: "neutral",
  cancelled: "neutral",
};

function stateLabel(state: string): string {
  return state.replaceAll("-", " ");
}

export function WorkCaseDetailView({ detail }: Props) {
  const { summary } = detail;

  return (
    <main className="space-y-5 text-[var(--dpf-text)]">
      <a
        href="/workspace/my-queue"
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--dpf-accent)] hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Work Cases
      </a>

      <header className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge intent={STATE_INTENT[summary.state] ?? "neutral"} label={stateLabel(summary.state)} variant="soft" />
              <StatusBadge intent={summary.attentionRequired ? "warning" : "neutral"} label={summary.urgencyLabel} variant="outline" />
              <span className="text-xs text-[var(--dpf-muted)]">{summary.sourceLabel}</span>
            </div>
            <h1 className="text-2xl font-semibold text-[var(--dpf-text)]">{summary.title}</h1>
            {summary.description ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">{summary.description}</p>
            ) : null}
          </div>
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]">
            <p className="text-xs text-[var(--dpf-muted)]">Next action</p>
            <p className="mt-1 font-semibold">{summary.nextAction}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <p className="text-xs text-[var(--dpf-muted)]">Assignment</p>
            <p className="mt-1 text-sm font-medium">{summary.assignmentLabel}</p>
          </div>
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <p className="text-xs text-[var(--dpf-muted)]">Effort</p>
            <p className="mt-1 text-sm font-medium">{summary.effortLabel}</p>
          </div>
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <p className="text-xs text-[var(--dpf-muted)]">A2A status</p>
            <p className="mt-1 text-sm font-medium">{summary.a2aStatus}</p>
          </div>
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <p className="text-xs text-[var(--dpf-muted)]">Due</p>
            <p className="mt-1 inline-flex items-center gap-1 text-sm font-medium">
              <Clock className="size-3.5" aria-hidden="true" />
              {summary.dueAt ? <LocalTime value={summary.dueAt} mode="date" /> : "No due date"}
            </p>
          </div>
        </div>
      </header>

      <section aria-labelledby="work-case-evidence-title" className="overflow-hidden rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <div className="flex items-center gap-2 border-b border-[var(--dpf-border)] px-4 py-3">
          <ShieldCheck className="size-4 text-[var(--dpf-success)]" aria-hidden="true" />
          <h2 id="work-case-evidence-title" className="text-sm font-semibold text-[var(--dpf-text)]">
            Evidence timeline
          </h2>
        </div>
        {detail.evidenceTimeline.length > 0 ? (
          <ol className="divide-y divide-[var(--dpf-border)]">
            {detail.evidenceTimeline.map((event) => (
              <li key={event.eventId} className="px-4 py-3">
                <p className="text-sm font-medium text-[var(--dpf-text)]">{event.label}</p>
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                  {event.sourceRef.kind} · {event.sourceRef.status ?? event.sourceRef.id}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <div className="px-4 py-6 text-sm text-[var(--dpf-muted)]">
            No evidence has been recorded for this case yet.
          </div>
        )}
      </section>

      <WorkItemCommentThread thread={detail.commentThread} />

      <section aria-labelledby="work-case-source-title" className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-[var(--dpf-muted)]" aria-hidden="true" />
          <h2 id="work-case-source-title" className="text-sm font-semibold text-[var(--dpf-text)]">Source refs</h2>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {detail.sourceRefs.map((ref) => (
            <div key={`${ref.kind}:${ref.id}`} className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
              <p className="text-xs text-[var(--dpf-muted)]">{ref.kind}</p>
              <p className="mt-1 truncate text-sm font-medium text-[var(--dpf-text)]">{ref.id}</p>
              {ref.status ? <p className="mt-1 text-xs text-[var(--dpf-muted)]">{ref.status}</p> : null}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
