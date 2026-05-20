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
 */
export function StallEventHistoryStrip({ buildId }: { buildId: string | null | undefined }) {
  const [events, setEvents] = useState<StallEventHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
        Stall history{" "}
        <span className="text-xs font-normal text-[var(--dpf-muted)]">
          ({events.length} event{events.length === 1 ? "" : "s"})
        </span>
      </h3>
      <ol className="mt-2 space-y-1">
        {events.map((ev) => (
          <li
            key={ev.id}
            className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-2 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-[var(--dpf-text)]">
                {humanReason(ev.reason)} — phase {ev.phase ?? "—"}
              </span>
              <span className="text-[var(--dpf-muted)]">
                {timeAgo(ev.detectedAt)}
              </span>
            </div>
            <div className="mt-1 text-[var(--dpf-muted)]">
              Thresholds: {ev.thresholdHeartbeatS}s heartbeat / {ev.thresholdTotalS}s total.
              {ev.outcome ? (
                <>
                  {" "}
                  Outcome:{" "}
                  <span className="font-medium text-[var(--dpf-text)]">{ev.outcome}</span>
                </>
              ) : (
                <span className="ml-1 text-[var(--dpf-warning)]">pending</span>
              )}
            </div>
            {ev.notes ? (
              <div className="mt-1 italic text-[var(--dpf-muted)]">{ev.notes}</div>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
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
