import { ButtonLink } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import { Surface } from "@/components/ui/Surface";
import type { DeliveryTaskHubRow } from "@/lib/work-capsules/delivery-task-hub";

function stableTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function ageLabel(value: string, observedAt: string): string {
  const source = new Date(value).getTime();
  const observation = new Date(observedAt).getTime();
  if (!Number.isFinite(source) || !Number.isFinite(observation)) return "Unknown";
  const minutes = Math.max(0, Math.floor((observation - source) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function ActionLink({ action, title, primary = false, pageNextAction = false }: {
  action: { label: string; href: string };
  title: string;
  primary?: boolean;
  pageNextAction?: boolean;
}) {
  return (
    <ButtonLink
      variant={primary ? "primary" : "secondary"}
      className="min-h-11"
      href={action.href}
      aria-label={`${action.label} ${title}`}
      {...(/^https:\/\//.test(action.href) ? { rel: "noreferrer" } : {})}
      {...(pageNextAction ? { "data-dpf-primary-action": "", "data-owner-first-next-action": "delivery-task" } : {})}
    >
      {action.label}
    </ButtonLink>
  );
}

function Progress({ row }: { row: DeliveryTaskHubRow }) {
  const progress = row.progress;
  if (!progress) return null;
  const count = progress.completed != null && progress.total != null
    ? `${progress.completed} of ${progress.total}`
    : null;
  const copy = progress.summary ?? progress.message ?? progress.waitReason ?? progress.error;
  return (
    <div className="space-y-1 text-xs text-[var(--dpf-muted)]">
      {copy ? <p>{copy}</p> : null}
      {count || progress.percent != null ? (
        <div className="flex items-center gap-2">
          {count ? <span>{count}</span> : null}
          {progress.percent != null ? (
            <progress className="h-2 min-w-24 flex-1 accent-[var(--dpf-accent)]" max={100} value={progress.percent} aria-label={`${row.title} progress`} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DeliveryTaskCard({ row, observationTime, pageNextAction = false }: {
  row: DeliveryTaskHubRow;
  observationTime: string;
  pageNextAction?: boolean;
}) {
  const operation = row.asyncOperation;
  return (
    <Surface as="article" rounded="xl" className="flex h-full min-w-0 flex-col gap-3 shadow-sm">
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate font-semibold text-[var(--dpf-text)]">{row.title}</h4>
          <p className="mt-1 line-clamp-2 text-sm text-[var(--dpf-muted)]">{row.objective}</p>
        </div>
        <StatusBadge intent={row.statusIntent} label={row.stageLabel} uppercase={false} />
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div className="min-w-0"><dt className="text-[var(--dpf-muted)]">Owner</dt><dd className="truncate font-medium text-[var(--dpf-text)]">{row.ownerLabel}</dd></div>
        <div className="min-w-0"><dt className="text-[var(--dpf-muted)]">Age</dt><dd className="truncate text-[var(--dpf-text)]"><time dateTime={row.observedAt} title={stableTimestamp(row.observedAt)}>{ageLabel(row.observedAt, observationTime)}</time></dd></div>
        {row.branch ? <div className="col-span-2 min-w-0"><dt className="text-[var(--dpf-muted)]">Branch</dt><dd className="truncate font-mono text-[var(--dpf-text)]">{row.branch}</dd></div> : null}
      </dl>
      <Progress row={row} />
      {operation.coreHandleAvailable ? (
        <p className="min-w-0 text-xs text-[var(--dpf-muted)]">
          <span className="font-medium text-[var(--dpf-text)]">Async {operation.status.replaceAll("_", " ")}</span>
          {operation.progressPct != null ? ` · ${operation.progressPct}%` : ""}
          {operation.progressMessage ? ` · ${operation.progressMessage}` : ""}
          <span className="block truncate font-mono" title={operation.operationId}>{operation.operationId}</span>
        </p>
      ) : null}
      {row.latestTransition ? <p className="rounded-md bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]"><span className="font-medium">Latest:</span> {row.latestTransition.summary}</p> : null}
      {row.nextAction ? <p className="text-sm text-[var(--dpf-text)]"><span className="font-medium">Next:</span> {row.nextAction}</p> : null}
      {row.verifiedResult ? <p className="text-sm text-[var(--dpf-success)]">{row.verifiedResult}</p> : null}
      {row.freshness !== "fresh" ? <p className="text-xs text-[var(--dpf-warning)]">{row.freshnessReason ?? "This projection is incomplete."}</p> : null}
      <footer className="mt-auto flex flex-wrap gap-2 pt-1">
        <ActionLink action={row.primaryAction} title={row.title} primary pageNextAction={pageNextAction} />
        {row.secondaryActions.map((action) => <ActionLink key={`${action.label}:${action.href}`} action={action} title={row.title} />)}
      </footer>
      <p className="select-all font-mono text-dpf-caption text-[var(--dpf-muted)]">{row.capsuleId}{row.taskRunId ? ` · ${row.taskRunId}` : ""}</p>
    </Surface>
  );
}

export function DeliveryTaskGroupSection({ groupKey, label, rows, observationTime, pageNextCapsuleId }: {
  groupKey: string;
  label: string;
  rows: DeliveryTaskHubRow[];
  observationTime: string;
  pageNextCapsuleId: string | null;
}) {
  if (rows.length === 0) return null;
  const cards = (items: DeliveryTaskHubRow[]) => items.map((row) => (
    <DeliveryTaskCard key={row.capsuleId} row={row} observationTime={observationTime} pageNextAction={row.capsuleId === pageNextCapsuleId} />
  ));
  return (
    <section aria-labelledby={`delivery-group-${groupKey}`} className="space-y-2">
      <div className="flex items-center gap-2"><h3 id={`delivery-group-${groupKey}`} className="text-base font-semibold text-[var(--dpf-text)]">{label}</h3><span className="text-xs text-[var(--dpf-muted)]">{rows.length}</span></div>
      <div className="grid gap-3 lg:grid-cols-2">{cards(rows.slice(0, 2))}</div>
      {rows.length > 2 ? (
        <Surface padding="none"><details data-dpf-disclosure className="px-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-[var(--dpf-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">Show {rows.length - 2} more {label.toLowerCase()} tasks</summary>
          <div className="grid gap-3 pb-3 lg:grid-cols-2">{cards(rows.slice(2))}</div>
        </details></Surface>
      ) : null}
    </section>
  );
}
