"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/report-kit/EmptyState";
import { Notice } from "@/components/ui/report-kit/Notice";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import { Surface } from "@/components/ui/Surface";
import { useResilientEventSource } from "@/lib/hooks/useResilientEventSource";
import {
  DELIVERY_TASK_HUB_EVENT,
  mergeDeliveryTaskHubEvent,
  type DeliveryTaskHubClientState,
  type DeliveryTaskHubEvent,
} from "@/lib/work-capsules/delivery-task-stream";
import type { DeliveryTaskGroup, DeliveryTaskHubRow } from "@/lib/work-capsules/delivery-task-hub";
import type { DeliveryTaskHubPage } from "@/lib/work-capsules/delivery-task-hub-store";

const GROUPS: Array<{ key: DeliveryTaskGroup; label: string }> = [
  { key: "needs-attention", label: "Needs attention" },
  { key: "working", label: "Working" },
  { key: "waiting", label: "Waiting" },
  { key: "ready", label: "Ready" },
  { key: "complete", label: "Complete" },
];

function parseEvent(event: MessageEvent): DeliveryTaskHubEvent | null {
  try {
    const value = JSON.parse(String(event.data)) as { type?: unknown };
    return ["snapshot", "upsert", "remove", "error"].includes(String(value.type))
      ? value as DeliveryTaskHubEvent
      : null;
  } catch {
    return null;
  }
}

function stableTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function ageLabel(value: string, observedAt: string): string {
  const source = new Date(value).getTime();
  const observation = new Date(observedAt).getTime();
  if (!Number.isFinite(source) || !Number.isFinite(observation)) return "Unknown";
  const minutes = Math.max(0, Math.floor((observation - source) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function ActionLink({ action, title, primary = false, pageNextAction = false }: {
  action: { label: string; href: string };
  title: string;
  primary?: boolean;
  pageNextAction?: boolean;
}) {
  const ariaLabel = `${action.label} ${title}`;
  const actionMarkers = pageNextAction
    ? { "data-dpf-primary-action": "", "data-owner-first-next-action": "delivery-task" }
    : {};
  return (
    <ButtonLink
      variant={primary ? "primary" : "secondary"}
      className="min-h-11"
      href={action.href}
      aria-label={ariaLabel}
      {...(/^https:\/\//.test(action.href) ? { rel: "noreferrer" } : {})}
      {...actionMarkers}
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

function AsyncOperation({ row }: { row: DeliveryTaskHubRow }) {
  const operation = row.asyncOperation;
  if (!operation.coreHandleAvailable) return null;
  const status = operation.status.replaceAll("_", " ");
  return (
    <p className="min-w-0 text-xs text-[var(--dpf-muted)]">
      <span className="font-medium text-[var(--dpf-text)]">Async {status}</span>
      {operation.progressPct != null ? ` · ${operation.progressPct}%` : ""}
      {operation.progressMessage ? ` · ${operation.progressMessage}` : ""}
      <span className="block truncate font-mono" title={operation.operationId}>{operation.operationId}</span>
    </p>
  );
}

function DeliveryTaskCard({ row, observationTime, pageNextAction = false }: { row: DeliveryTaskHubRow; observationTime: string; pageNextAction?: boolean }) {
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
      <AsyncOperation row={row} />
      {row.latestTransition ? (
        <p className="rounded-md bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]">
          <span className="font-medium">Latest:</span> {row.latestTransition.summary}
        </p>
      ) : null}
      {row.nextAction ? <p className="text-sm text-[var(--dpf-text)]"><span className="font-medium">Next:</span> {row.nextAction}</p> : null}
      {row.verifiedResult ? <p className="text-sm text-[var(--dpf-success)]">{row.verifiedResult}</p> : null}
      {row.freshness !== "fresh" ? (
        <p className="text-xs text-[var(--dpf-warning)]">{row.freshnessReason ?? "This projection is incomplete."}</p>
      ) : null}

      <footer className="mt-auto flex flex-wrap gap-2 pt-1">
        <ActionLink action={row.primaryAction} title={row.title} primary pageNextAction={pageNextAction} />
        {row.secondaryActions.map((action) => <ActionLink key={`${action.label}:${action.href}`} action={action} title={row.title} />)}
      </footer>
      <p className="select-all font-mono text-dpf-caption text-[var(--dpf-muted)]">{row.capsuleId}{row.taskRunId ? ` · ${row.taskRunId}` : ""}</p>
    </Surface>
  );
}

export function DeliveryTaskHub({ initialPage }: { initialPage: DeliveryTaskHubPage }) {
  const [live, setLive] = useState<DeliveryTaskHubClientState>({ ...initialPage, error: null });
  const [olderRows, setOlderRows] = useState<DeliveryTaskHubRow[]>([]);
  const [olderCursor, setOlderCursor] = useState(initialPage.nextCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const pagingGenerationRef = useRef(0);
  const pagingAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => pagingAbortRef.current?.abort(), []);

  const onStreamEvent = useCallback((message: MessageEvent) => {
    const event = parseEvent(message);
    if (!event) return;
    setLive((current) => mergeDeliveryTaskHubEvent(current, event));
    if (event.type === "snapshot") {
      pagingGenerationRef.current += 1;
      pagingAbortRef.current?.abort();
      pagingAbortRef.current = null;
      setLoadingOlder(false);
      setOlderError(null);
      setOlderCursor(event.nextCursor);
      setOlderRows([]);
    }
    if (event.type === "upsert" || event.type === "remove") {
      const capsuleId = event.type === "upsert" ? event.row.capsuleId : event.capsuleId;
      setOlderRows((rows) => rows.filter((row) => row.capsuleId !== capsuleId));
    }
  }, []);
  const { status: streamStatus } = useResilientEventSource("/api/work-capsules/delivery-stream", {
    onMessage: () => {},
    onNamed: { [DELIVERY_TASK_HUB_EVENT]: onStreamEvent },
  });

  const rows = useMemo(() => {
    const seen = new Set(live.rows.map((row) => row.capsuleId));
    return [...live.rows, ...olderRows.filter((row) => !seen.has(row.capsuleId))];
  }, [live.rows, olderRows]);
  const pageNextCapsuleId = GROUPS.flatMap(({ key }) => rows.filter((row) => row.group === key))[0]?.capsuleId ?? null;
  const counts = useMemo(() => Object.fromEntries(GROUPS.map(({ key }) => [key, rows.filter((row) => row.group === key).length])), [rows]);

  const loadOlder = async () => {
    if (!olderCursor || loadingOlder || pagingAbortRef.current) return;
    const generation = pagingGenerationRef.current;
    const controller = new AbortController();
    pagingAbortRef.current = controller;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const response = await fetch(`/api/work-capsules/delivery-page?cursor=${encodeURIComponent(olderCursor)}`, { signal: controller.signal });
      if (!response.ok) throw new Error("page_failed");
      const page = await response.json() as DeliveryTaskHubPage;
      if (controller.signal.aborted || generation !== pagingGenerationRef.current) return;
      setOlderRows((current) => {
        const existing = new Set(current.map((row) => row.capsuleId));
        return [...current, ...page.rows.filter((row) => !existing.has(row.capsuleId))];
      });
      setOlderCursor(page.nextCursor);
    } catch {
      if (controller.signal.aborted || generation !== pagingGenerationRef.current) return;
      setOlderError("Older delivery tasks could not be loaded.");
    } finally {
      if (pagingAbortRef.current === controller) {
        pagingAbortRef.current = null;
        setLoadingOlder(false);
      }
    }
  };

  return (
    <section aria-labelledby="delivery-task-hub-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div data-dpf-lead>
          <h2 id="delivery-task-hub-heading" className="text-lg font-semibold text-[var(--dpf-text)]">Delivery task hub</h2>
          <p className="text-sm text-[var(--dpf-muted)]">Leave long-running work safely and return to the durable Workroom outcome.</p>
        </div>
        <span aria-live="polite" className="text-xs text-[var(--dpf-muted)]">
          {streamStatus === "open" ? "Live updates connected" : streamStatus === "reconnecting" ? "Reconnecting — confirmed tasks retained" : "Connecting to live updates"}
        </span>
      </div>

      <dl aria-label="Delivery task counts" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {GROUPS.map(({ key, label }) => (
          <Surface key={key} padding="sm">
            <dt className="text-xs text-[var(--dpf-muted)]">{label}</dt>
            <dd className="text-lg font-semibold text-[var(--dpf-text)]">{counts[key] ?? 0}</dd>
          </Surface>
        ))}
      </dl>

      {streamStatus === "reconnecting" ? <Notice variant="warn" title="Reconnecting">Confirmed Workrooms remain visible while the bounded snapshot reconnects.</Notice> : null}
      {live.error ? <Notice variant="warn" title="Live view could not refresh">Confirmed Workrooms are retained. The stream will reconcile from canonical records when it reconnects.</Notice> : null}

      {rows.length === 0 ? (
        <EmptyState title="No delivery Workrooms in this 30-day window" description="This is an empty observation window, not a delivery success signal." />
      ) : GROUPS.map(({ key, label }) => {
        const groupRows = rows.filter((row) => row.group === key);
        return groupRows.length > 0 ? (
          <section key={key} aria-labelledby={`delivery-group-${key}`} className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 id={`delivery-group-${key}`} className="text-base font-semibold text-[var(--dpf-text)]">{label}</h3>
              <span className="text-xs text-[var(--dpf-muted)]">{groupRows.length}</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {groupRows.slice(0, 2).map((item) => <DeliveryTaskCard key={item.capsuleId} row={item} observationTime={live.observedAt} pageNextAction={item.capsuleId === pageNextCapsuleId} />)}
            </div>
            {groupRows.length > 2 ? (
              <Surface padding="none">
                <details data-dpf-disclosure className="px-3">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-[var(--dpf-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
                    Show {groupRows.length - 2} more {label.toLowerCase()} tasks
                  </summary>
                  <div className="grid gap-3 pb-3 lg:grid-cols-2">
                    {groupRows.slice(2).map((item) => <DeliveryTaskCard key={item.capsuleId} row={item} observationTime={live.observedAt} />)}
                  </div>
                </details>
              </Surface>
            ) : null}
          </section>
        ) : null;
      })}

      {olderError ? <Notice variant="warn">{olderError}</Notice> : null}
      {olderCursor ? (
        <Button
          variant="secondary"
          className="min-h-11"
          onClick={() => void loadOlder()}
          disabled={loadingOlder}
          aria-label="Load older delivery tasks"
        >
          {loadingOlder ? "Loading older tasks…" : "Load older tasks"}
        </Button>
      ) : rows.length > 0 ? <p className="text-xs text-[var(--dpf-muted)]">No more delivery tasks in this window.</p> : null}
    </section>
  );
}
