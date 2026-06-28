import { ArrowLeft, CalendarClock, MessageCircle, ShieldCheck } from "lucide-react";

import { LocalTime } from "@/components/ui/LocalTime";
import { StatusBadge } from "@/components/ui/report-kit";
import type { Intent } from "@/components/ui/report-kit/statusColors";
import type { PortalWorkCaseDetailView } from "@/lib/work-management/portal-case-loader";

type Props = {
  view: PortalWorkCaseDetailView;
};

const STATUS_INTENT: Record<string, Intent> = {
  "Needs your response": "warning",
  "In progress": "accent",
  "Waiting on service": "info",
  Received: "info",
  Resolved: "success",
  Cancelled: "neutral",
};

export function PortalWorkCaseDetail({ view }: Props) {
  const item = view.case;
  const statusIntent = STATUS_INTENT[item.statusLabel] ?? "neutral";

  return (
    <main className="space-y-5 text-[var(--dpf-text)]">
      <header className="space-y-4">
        <a
          href="/portal/cases"
          className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-sm font-medium text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)]"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Cases
        </a>

        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusBadge intent={statusIntent} label={item.statusLabel} variant="soft" />
                <span className="text-xs text-[var(--dpf-muted)]">{item.sourceLabel}</span>
              </div>
              <h1 className="text-2xl font-semibold text-[var(--dpf-text)]">{item.title}</h1>
              {item.description ? (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
                  {item.description}
                </p>
              ) : null}
            </div>
            <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm">
              <p className="text-xs text-[var(--dpf-muted)]">Next</p>
              <p className="mt-1 font-semibold text-[var(--dpf-text)]">{item.nextActionLabel}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--dpf-muted)]">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Visible to your account
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3.5" aria-hidden="true" />
              Received <LocalTime value={item.createdAt} mode="date" />
            </span>
            {item.dueAt ? (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3.5" aria-hidden="true" />
                Due <LocalTime value={item.dueAt} mode="date" />
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <section
        aria-label="Case timeline"
        className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">Timeline</h2>
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">
              Recent customer-visible updates for this case.
            </p>
          </div>
          <a
            href={item.supportHref}
            className="inline-flex min-h-9 w-fit items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-3)]"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            Contact support
          </a>
        </div>

        <ol className="mt-4 space-y-3">
          {view.timeline.map((event) => (
            <li
              key={`${event.label}-${event.at ?? event.body}`}
              className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-semibold text-[var(--dpf-text)]">{event.label}</p>
                {event.at ? (
                  <span className="text-xs text-[var(--dpf-muted)]">
                    <LocalTime value={event.at} mode="date" />
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm leading-6 text-[var(--dpf-muted)]">{event.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
