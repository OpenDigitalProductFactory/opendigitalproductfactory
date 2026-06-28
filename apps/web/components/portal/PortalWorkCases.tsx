import { ArrowRight, Clock, Inbox, MessageCircle, ShieldCheck } from "lucide-react";

import { LocalTime } from "@/components/ui/LocalTime";
import { StatCard, StatusBadge } from "@/components/ui/report-kit";
import type { Intent } from "@/components/ui/report-kit/statusColors";
import type {
  PortalWorkCaseListItem,
  PortalWorkCaseListView,
} from "@/lib/work-management/portal-case-loader";

type Props = {
  view: PortalWorkCaseListView;
};

const STATUS_INTENT: Record<string, Intent> = {
  "Needs your response": "warning",
  "In progress": "accent",
  "Waiting on service": "info",
  Received: "info",
  Resolved: "success",
  Cancelled: "neutral",
};

function CaseCard({ item }: { item: PortalWorkCaseListItem }) {
  return (
    <article
      id={item.href.split("#")[1]}
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-[var(--dpf-text)]"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge
              intent={STATUS_INTENT[item.statusLabel] ?? "neutral"}
              label={item.statusLabel}
              variant="soft"
            />
            <span className="text-xs text-[var(--dpf-muted)]">{item.sourceLabel}</span>
          </div>
          <h2 className="text-base font-semibold text-[var(--dpf-text)]">{item.title}</h2>
          {item.description ? (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--dpf-muted)]">{item.description}</p>
          ) : null}
        </div>
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm">
          <p className="text-xs text-[var(--dpf-muted)]">Next</p>
          <p className="mt-1 font-semibold text-[var(--dpf-text)]">{item.nextActionLabel}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--dpf-muted)]">
        {item.dueAt ? (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" aria-hidden="true" />
            <LocalTime value={item.dueAt} mode="date" />
          </span>
        ) : null}
        {item.attentionRequired ? (
          <a
            href="/portal/support"
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-3)]"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            Reply
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 text-[var(--dpf-muted)]">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Visible to your account
          </span>
        )}
      </div>
    </article>
  );
}

export function PortalWorkCases({ view }: Props) {
  return (
    <main className="space-y-5 text-[var(--dpf-text)]">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">Portal</p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--dpf-text)]">Cases</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
            Requests and service updates that are visible to your account.
          </p>
        </div>
        <a
          href="/portal/support"
          className="inline-flex min-h-9 w-fit items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
        >
          <Inbox className="size-4" aria-hidden="true" />
          Contact support
          <ArrowRight className="size-4" aria-hidden="true" />
        </a>
      </header>

      <section aria-label="Case summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open cases" value={view.stats.total} intent="accent" />
        <StatCard label="Needs response" value={view.stats.needsResponse} intent="warning" />
        <StatCard label="In progress" value={view.stats.inProgress} intent="info" />
        <StatCard label="Resolved" value={view.stats.resolved} intent="success" />
      </section>

      {view.cases.length === 0 ? (
        <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-10 text-center">
          <ShieldCheck className="mx-auto size-8 text-[var(--dpf-muted)]" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold text-[var(--dpf-text)]">No open cases</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--dpf-muted)]">
            New requests and service updates will appear here.
          </p>
        </section>
      ) : (
        <section aria-label="Visible cases" className="grid gap-3">
          {view.cases.map((item) => (
            <CaseCard key={item.caseId} item={item} />
          ))}
        </section>
      )}
    </main>
  );
}
