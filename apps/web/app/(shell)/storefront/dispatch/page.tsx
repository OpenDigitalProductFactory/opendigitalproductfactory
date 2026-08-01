// apps/web/app/(shell)/storefront/dispatch/page.tsx
//
// EP-3516E23D field-service dispatch board. Shows field-service-job WorkItems as
// a scan-first operations surface: attention, assignment, route, schedule, and
// support signals before the lane detail.

import Link from "next/link";
import { AlertTriangle, CalendarClock, MapPin, Route, UserCheck, Wrench } from "lucide-react";
import { prisma } from "@dpf/db";
import { EmptyState, KpiCard, Notice, StatusBadge } from "@/components/ui/report-kit";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import {
  getDispatchBoard,
  type DispatchBoard,
  type DispatchJobView,
} from "@/lib/storefront/dispatch-board-data";

export const dynamic = "force-dynamic";

const FIELD_SERVICE_CATEGORY = "trades-maintenance";

function urgencyIntent(urgency: string): "danger" | "warning" | "info" | "neutral" {
  if (urgency === "emergency") return "danger";
  if (urgency === "urgent") return "warning";
  if (urgency === "priority") return "info";
  return "neutral";
}

function attentionIntent(count: number): "danger" | "success" {
  return count > 0 ? "danger" : "success";
}

function concernIntent(count: number): "warning" | "success" {
  return count > 0 ? "warning" : "success";
}

function formatDue(iso: string | null): string {
  if (!iso) return "No time set";
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

function JobCard({ job }: { job: DispatchJobView }) {
  return (
    <article
      aria-label={`${job.title}: ${job.statusLabel}, ${job.assignmentLabel}, due ${formatDue(job.dueAt)}`}
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-[var(--dpf-text)]">{job.title}</h4>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">{formatDue(job.dueAt)}</p>
        </div>
        <StatusBadge domain="fieldDispatchJob" status={job.status} label={job.statusLabel} size="sm" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge intent={urgencyIntent(job.urgency)} label={job.urgency} size="sm" />
        <StatusBadge
          intent={job.assigned ? "success" : "warning"}
          label={job.assignmentLabel}
          size="sm"
          uppercase={false}
        />
      </div>
      {job.attentionReasons.length > 0 ? (
        <ul
          aria-label={`Attention reasons for ${job.title}`}
          className="mt-2 grid gap-1 text-xs text-[var(--dpf-muted)]"
        >
          {job.attentionReasons.map((reason) => (
            <li key={reason} className="flex gap-1">
              <span aria-hidden="true">-</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function RouteView({ board }: { board: DispatchBoard }) {
  if (board.routeStops.length === 0) {
    return (
      <EmptyState
        title="Route"
        size="sm"
      />
    );
  }

  return (
    <ol aria-label="Route order" className="grid gap-2">
      {board.routeStops.map((job, index) => (
        <li
          key={job.itemId}
          aria-label={`Stop ${index + 1}: ${job.title}, ${formatDue(job.dueAt)}`}
          aria-current={index === 0 ? "step" : undefined}
          aria-posinset={index + 1}
          aria-setsize={board.routeStops.length}
          className="grid grid-cols-[2rem_1fr] gap-2"
        >
          <div className="flex flex-col items-center">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-xs font-semibold text-[var(--dpf-text)]"
            >
              {index + 1}
            </span>
            {index < board.routeStops.length - 1 ? (
              <span aria-hidden="true" className="min-h-5 w-px flex-1 bg-[var(--dpf-border)]" />
            ) : null}
          </div>
          <div className="min-w-0 pb-2">
            <p className="truncate text-sm font-medium text-[var(--dpf-text)]">{job.title}</p>
            <p className="text-xs text-[var(--dpf-muted)]">{formatDue(job.dueAt)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ScheduleView({ board }: { board: DispatchBoard }) {
  const jobs = board.routeStops.slice(0, 5);
  if (jobs.length === 0) {
    return (
      <EmptyState
        title="Schedule"
        size="sm"
      />
    );
  }

  return (
    <ol aria-label="Upcoming dispatch schedule" className="grid gap-2">
      {jobs.map((job) => (
        <li
          key={job.itemId}
          aria-label={`${formatDue(job.dueAt)}: ${job.title}; ${job.assignmentLabel}`}
          className="grid grid-cols-[6rem_1fr] gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
        >
          <p className="text-xs font-semibold text-[var(--dpf-text)]">
            {job.dueAt ? job.dueAt.slice(11, 16) : "--:--"} UTC
          </p>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--dpf-text)]">{job.title}</p>
            <p className="text-xs text-[var(--dpf-muted)]">{job.assignmentLabel}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function SupportChecks({ board }: { board: DispatchBoard }) {
  const checks = [
    {
      label: "Assign",
      value: board.summary.unassigned === 0 ? "Covered" : `${board.summary.unassigned} open`,
      intent: concernIntent(board.summary.unassigned),
    },
    {
      label: "Bill",
      value:
        board.summary.readyToInvoice === 0
          ? "Clear"
          : `${board.summary.readyToInvoice} job${board.summary.readyToInvoice === 1 ? "" : "s"}`,
      intent: concernIntent(board.summary.readyToInvoice),
    },
    {
      label: "Parts",
      value: String(board.summary.partsUsed),
      intent: board.summary.partsUsed > 0 ? "info" : "neutral",
    },
  ] as const;

  return (
    <div className="grid gap-2">
      {checks.map((check) => (
        <div
          key={check.label}
          className="flex items-center justify-between gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2"
        >
          <span className="text-xs text-[var(--dpf-muted)]">{check.label}</span>
          <StatusBadge intent={check.intent} label={check.value} size="sm" uppercase={false} />
        </div>
      ))}
    </div>
  );
}

function DispatchOperationsSurface({ board }: { board: DispatchBoard }) {
  const hasJobs = board.total > 0;

  return (
    <section aria-label="Dispatch operations" className="grid gap-5">
      <section
        aria-label="Dispatch metrics"
        role="region"
        className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]"
      >
        <KpiCard
          value={board.summary.needsAttention}
          label="Alerts"
          intent={attentionIntent(board.summary.needsAttention)}
          size="sm"
          icon={<AlertTriangle size={18} />}
        />
        <KpiCard
          value={board.summary.unassigned}
          label="Unassigned"
          intent={concernIntent(board.summary.unassigned)}
          size="sm"
          icon={<UserCheck size={18} />}
        />
        <KpiCard
          value={board.summary.active}
          label="Active"
          intent={board.summary.active > 0 ? "accent" : "neutral"}
          size="sm"
          icon={<Route size={18} />}
        />
        <KpiCard
          value={board.summary.readyToInvoice}
          label="Billing"
          intent={concernIntent(board.summary.readyToInvoice)}
          size="sm"
          icon={<Wrench size={18} />}
        />
      </section>

      {!hasJobs ? (
        <EmptyState
          title="Dispatch"
          action={
            <Link
              href="/storefront/bookings"
              className="text-sm font-medium text-[var(--dpf-accent)] hover:underline"
            >
              Bookings
            </Link>
          }
        />
      ) : null}

      {board.summary.needsAttention > 0 ? (
        <Notice variant="warn" title="Attention" />
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <section
          aria-labelledby="dispatch-schedule-heading"
          className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock size={18} aria-hidden="true" className="text-[var(--dpf-accent)]" />
            <h3 id="dispatch-schedule-heading" className="text-sm font-semibold text-[var(--dpf-text)]">
              Schedule
            </h3>
          </div>
          <ScheduleView board={board} />
        </section>

        <section
          aria-labelledby="dispatch-route-heading"
          className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <MapPin size={18} aria-hidden="true" className="text-[var(--dpf-accent)]" />
            <h3 id="dispatch-route-heading" className="text-sm font-semibold text-[var(--dpf-text)]">
              Route
            </h3>
          </div>
          <RouteView board={board} />
        </section>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
        <div className="grid gap-3">
          <h3 id="dispatch-lanes-heading" className="text-sm font-semibold text-[var(--dpf-text)]">
            Lanes
          </h3>
          <div
            aria-labelledby="dispatch-lanes-heading"
            role="region"
            tabIndex={0}
            className="grid gap-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)] [grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))]"
          >
            {board.columns.map((col) => (
              <section
                key={col.key}
                aria-label={col.label}
                className="min-h-32 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
                    {col.label}
                  </h4>
                  <span className="text-xs font-semibold tabular-nums text-[var(--dpf-text)]">{col.jobs.length}</span>
                </div>
                <div className="grid gap-2">
                  {col.jobs.length === 0 ? (
                    <p className="text-xs text-[var(--dpf-muted)]">Empty.</p>
                  ) : (
                    col.jobs.map((jobItem) => <JobCard key={jobItem.itemId} job={jobItem} />)
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>

        <section
          aria-labelledby="dispatch-support-heading"
          className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
        >
          <div className="mb-3 flex items-center gap-2">
            <Wrench size={18} aria-hidden="true" className="text-[var(--dpf-accent)]" />
            <h3 id="dispatch-support-heading" className="text-sm font-semibold text-[var(--dpf-text)]">
              Support
            </h3>
          </div>
          <SupportChecks board={board} />
        </section>
      </section>
    </section>
  );
}

export default async function DispatchBoardPage() {
  const config = await prisma.storefrontConfig.findFirst({
    select: { id: true, archetype: { select: { category: true, customVocabulary: true } } },
  });

  if (!config) {
    return (
      <div style={{ color: "var(--dpf-muted)", fontSize: 14 }}>
        Storefront required.{" "}
        <Link href="/storefront/setup" style={{ color: "var(--dpf-accent)" }}>
          Setup
        </Link>
        .
      </div>
    );
  }

  const category = config.archetype?.category ?? null;
  const vocabulary = getVocabulary(
    category ?? undefined,
    (config.archetype?.customVocabulary as Record<string, string> | null) ?? null,
  );

  if (category !== FIELD_SERVICE_CATEGORY) {
    return (
      <div style={{ color: "var(--dpf-muted)", fontSize: 14, maxWidth: 640 }}>
        Field-service required.
      </div>
    );
  }

  const board = await getDispatchBoard(config.id);

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="m-0 text-base font-bold text-[var(--dpf-text)]">
          Dispatch
        </h2>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          {vocabulary.teamLabel}: {board.total} job{board.total === 1 ? "" : "s"}.
        </p>
      </div>

      <DispatchOperationsSurface board={board} />
    </div>
  );
}
