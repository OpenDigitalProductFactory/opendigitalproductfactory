import { AlertTriangle, ArrowRight, Clock, Inbox, ListChecks, Smartphone, UserCheck } from "lucide-react";

import { LocalTime } from "@/components/ui/LocalTime";
import { EmptyState, StatCard, StatusBadge } from "@/components/ui/report-kit";
import {
  roomLabel,
  WORK_STATE_INTENT,
} from "@/components/workspace/work-room/presentation";
import type {
  WorkspaceWorkCaseLensView,
  WorkspaceWorkCaseListItem,
} from "@/lib/work-management/workspace-case-loader";

type Props = {
  view: WorkspaceWorkCaseLensView;
};

function CaseRow({ item, compact = false }: { item: WorkspaceWorkCaseListItem; compact?: boolean }) {
  return (
    <a
      href={item.href}
      className="grid min-h-11 gap-3 border-b border-[var(--dpf-border)] px-4 py-3 text-[var(--dpf-text)] transition-colors last:border-b-0 hover:bg-[var(--dpf-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--dpf-accent)] md:grid-cols-[minmax(0,1fr)_auto]"
    >
      <span className="sr-only">Open room: {item.title}</span>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <StatusBadge intent={WORK_STATE_INTENT[item.state]} label={roomLabel(item.state)} variant="soft" />
          <StatusBadge intent={item.attentionRequired ? "warning" : "neutral"} label={item.urgencyLabel} variant="outline" />
          <span className="text-xs text-[var(--dpf-muted)]">{item.sourceLabel}</span>
        </div>
        <h2 className="truncate text-sm font-semibold text-[var(--dpf-text)]">{item.title}</h2>
        {!compact && item.description ? (
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--dpf-muted)]">{item.description}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--dpf-muted)]">
          <span className="inline-flex items-center gap-1">
            <UserCheck className="size-3.5" aria-hidden="true" />
            {item.assignmentLabel}
          </span>
          <span>{item.effortLabel}</span>
          {item.dueAt ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" aria-hidden="true" />
              <LocalTime value={item.dueAt} mode="date" />
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 md:justify-end">
        <span className="text-xs font-medium text-[var(--dpf-text)]">{item.nextAction}</span>
        <ArrowRight className="size-4 text-[var(--dpf-muted)]" aria-hidden="true" />
      </div>
    </a>
  );
}

function MobileAttentionStrip({ items }: { items: WorkspaceWorkCaseListItem[] }) {
  const visibleItems = items.slice(0, 3);
  if (visibleItems.length === 0) return null;

  return (
    <section
      aria-label="Mobile attention"
      className="grid gap-2 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 md:hidden"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2">
          <Smartphone className="size-4 text-[var(--dpf-accent)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Today</h2>
        </div>
        <StatusBadge intent="warning" label={`${items.length} needs you`} variant="soft" />
      </div>
      <div className="grid gap-2">
        {visibleItems.map((item) => (
          <a
            key={item.caseId}
            href={item.href}
            className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            <span className="sr-only">Open room: {item.title}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[var(--dpf-text)]">{item.title}</span>
              <span className="mt-1 block truncate text-xs text-[var(--dpf-muted)]">{item.nextAction}</span>
            </span>
            <ArrowRight className="size-4 text-[var(--dpf-muted)]" aria-hidden="true" />
          </a>
        ))}
      </div>
    </section>
  );
}

export function WorkCaseAttentionLens({ view }: Props) {
  const attentionCases = view.cases.filter((item) => item.attentionRequired);

  return (
    <main className="space-y-5 text-[var(--dpf-text)]">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">Workspace</p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--dpf-text)]">My Work</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
            Your active Work Rooms, ordered by what needs attention first.
          </p>
        </div>
        <a
          href="/workspace/inbox"
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          <Inbox className="size-4" aria-hidden="true" />
          Needs you
        </a>
      </header>

      <section aria-label="Work Room summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Needs attention" value={view.stats.needsAttention} intent="warning" />
        <StatCard label="Active" value={view.stats.active} intent="accent" />
        <StatCard label="Unassigned" value={view.stats.unassigned} intent="info" />
        <StatCard label="Due soon" value={view.stats.dueSoon} intent="danger" />
      </section>

      <MobileAttentionStrip items={attentionCases} />

      {view.cases.length === 0 ? (
        <EmptyState
          title="No active Work Rooms"
          description="New rooms will appear here when work is assigned or made available for claiming."
          icon={<ListChecks className="size-8" />}
        />
      ) : (
        <>
          <section aria-labelledby="work-room-attention-title" className="overflow-hidden rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
            <div className="flex items-center gap-2 border-b border-[var(--dpf-border)] px-4 py-3">
              <AlertTriangle className="size-4 text-[var(--dpf-warning)]" aria-hidden="true" />
              <h2 id="work-room-attention-title" className="text-sm font-semibold text-[var(--dpf-text)]">
                Needs attention
              </h2>
              <span className="text-xs text-[var(--dpf-muted)]">{attentionCases.length}</span>
            </div>
            {attentionCases.length > 0 ? (
              attentionCases.map((item) => <CaseRow key={item.caseId} item={item} />)
            ) : (
              <div className="px-4 py-6 text-sm text-[var(--dpf-muted)]">
                Nothing requires your attention right now.
              </div>
            )}
          </section>

          <section aria-labelledby="work-room-all-title" className="overflow-hidden rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
            <div className="border-b border-[var(--dpf-border)] px-4 py-3">
              <h2 id="work-room-all-title" className="text-sm font-semibold text-[var(--dpf-text)]">
                All active rooms
              </h2>
            </div>
            {view.cases.map((item) => <CaseRow key={item.caseId} item={item} compact />)}
          </section>
        </>
      )}
    </main>
  );
}
