"use client";

import { useEffect, useState } from "react";
import {
  getStallEventsForBuild,
  type StallEventHistoryEntry,
} from "@/lib/actions/stall-event-history";

/**
 * Build Studio phase panel — StallEvent history strip (BI-4ab6be39 F3).
 *
 * Renders a compact list of recent stall events for the given build so the
 * operator can see at a glance whether a phase is stalling repeatedly.
 * Each event shows reason, phase, age, and outcome (if resolved).
 *
 * Repeats are folded (2026-05-21): when a build re-spawns deliberation
 * TaskRuns in rapid succession (e.g. a recovery loop), the watchdog writes
 * one StallEvent per TaskRun, which previously rendered as N identical
 * "Heartbeat timeout — phase build" lines. The strip now folds runs of
 * consecutive same-reason / same-phase / same-outcome entries into a single
 * row with a "× N (oldest – newest)" label so the noise stays compact.
 */
export function StallEventHistoryStrip({ buildId }: { buildId: string | null | undefined }) {
  const [events, setEvents] = useState<StallEventHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!buildId) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    getStallEventsForBuild(buildId)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [buildId]);

  if (!buildId) return null;
  if (error) {
    return (
      <p className="text-xs text-[var(--dpf-error)]">
        Couldn&apos;t load stall history: {error}
      </p>
    );
  }
  if (events === null) {
    return (
      <p className="text-xs text-[var(--dpf-muted)]">Loading stall history...</p>
    );
  }
  if (events.length === 0) return null;

  const groups = groupConsecutiveSimilar(events);
  const groupCountLabel = groups.length === events.length
    ? `${events.length} event${events.length === 1 ? "" : "s"}`
    : `${events.length} event${events.length === 1 ? "" : "s"} in ${groups.length} group${groups.length === 1 ? "" : "s"}`;

  return (
    <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
        Stall history{" "}
        <span className="text-xs font-normal text-[var(--dpf-muted)]">({groupCountLabel})</span>
      </h3>
      <ol className="mt-2 space-y-1">
        {groups.map((group) => {
          const isFolded = group.entries.length > 1;
          const isExpanded = expandedGroups.has(group.key);
          const head = group.entries[0]; // newest entry in the group

          return (
            <li
              key={group.key}
              className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-[var(--dpf-text)]">
                  {humanReason(head.reason)} — phase {head.phase ?? "—"}
                  {isFolded ? (
                    <span className="ml-1 text-[var(--dpf-muted)]">× {group.entries.length}</span>
                  ) : null}
                </span>
                <span className="text-[var(--dpf-muted)]">
                  {isFolded
                    ? `${timeAgo(group.entries[group.entries.length - 1]!.detectedAt)} – ${timeAgo(head.detectedAt)}`
                    : timeAgo(head.detectedAt)}
                </span>
              </div>
              <div className="mt-1 text-[var(--dpf-muted)]">
                Thresholds: {head.thresholdHeartbeatS}s heartbeat / {head.thresholdTotalS}s total.
                {head.outcome ? (
                  <>
                    {" "}
                    Outcome:{" "}
                    <span className="font-medium text-[var(--dpf-text)]">{head.outcome}</span>
                  </>
                ) : (
                  <span className="ml-1 text-[var(--dpf-warning)]">pending</span>
                )}
              </div>
              {head.notes ? (
                <div className="mt-1 italic text-[var(--dpf-muted)]">{head.notes}</div>
              ) : null}
              {isFolded ? (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
                  }
                  className="mt-1 text-[var(--dpf-accent)] hover:underline"
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? "Hide individual events" : `Show all ${group.entries.length} events`}
                </button>
              ) : null}
              {isFolded && isExpanded ? (
                <ol className="mt-2 space-y-1 border-l border-[var(--dpf-border)] pl-2">
                  {group.entries.map((ev) => (
                    <li key={ev.id} className="text-[var(--dpf-muted)]">
                      <span className="text-[var(--dpf-text)]">{timeAgo(ev.detectedAt)}</span>
                      {ev.taskRunBusinessId ? <> — {ev.taskRunBusinessId}</> : null}
                      {ev.outcome ? <> — {ev.outcome}</> : <> — <span className="text-[var(--dpf-warning)]">pending</span></>}
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Internal: shape returned by groupConsecutiveSimilar. Exported for the
 * unit test only — not part of the component's public surface.
 */
export interface StallEventGroup {
  /** Stable key derived from reason/phase/outcome + head id. */
  key: string;
  /** Entries in the same order as input (newest first). */
  entries: StallEventHistoryEntry[];
}

/**
 * Fold consecutive entries that share (reason, phase, outcome=null|present)
 * into one group. Entries with a resolved outcome (retry/abandoned/
 * escalated) are NOT folded — each operator action deserves its own row
 * because the notes/outcomeBy differ. Only the noisy "pending" runs are
 * collapsed.
 *
 * Input is assumed to be newest-first (matches getStallEventsForBuild's
 * orderBy detectedAt desc).
 *
 * Exported for unit tests; the component imports it implicitly via render.
 */
export function groupConsecutiveSimilar(
  events: StallEventHistoryEntry[],
): StallEventGroup[] {
  const groups: StallEventGroup[] = [];
  for (const ev of events) {
    const last = groups[groups.length - 1];
    if (
      last &&
      // Only fold pending (unresolved) entries. Resolved ones each got a
      // distinct operator action — show them individually.
      last.entries[0]!.outcome === null &&
      ev.outcome === null &&
      last.entries[0]!.reason === ev.reason &&
      last.entries[0]!.phase === ev.phase
    ) {
      last.entries.push(ev);
    } else {
      groups.push({
        key: `${ev.id}-${ev.reason}-${ev.phase ?? "none"}`,
        entries: [ev],
      });
    }
  }
  return groups;
}

function humanReason(reason: string): string {
  switch (reason) {
    case "heartbeat_timeout":
      return "Heartbeat timeout";
    case "total_timeout":
      return "Total phase budget exceeded";
    case "never_started":
      return "Never started";
    case "parent_stalled":
      return "Parent stalled (cascade)";
    case "parent_abandoned":
      return "Parent abandoned (cascade)";
    default:
      return reason;
  }
}

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
