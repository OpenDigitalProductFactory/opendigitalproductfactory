"use client";

// Live-refresh shell around the AI Operations Map (BI-44D3203D + BI-40EFC7DE).
//
// The map page server-renders one snapshot; this shell keeps it honest about
// time afterwards:
//  - polls /api/platform/operations-map on an interval (paused while the tab
//    is hidden and held off right after the operator scrubs),
//  - re-fetches with an explicit ?start&end evidence window when the operator
//    scrubs/zooms the replay timeline to a materially different window, so
//    history depth comes from the DB rather than the newest-40 boot snapshot,
//  - surfaces a last-refreshed indicator + manual refresh.
//
// Feedback-loop guards (the panel republishes its window after every data
// swap, and new data shifts the range end by padding): swap-echo publishes are
// ignored for a short beat, and only materially different windows re-fetch.

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AiOperationsMap } from "./AiOperationsMap";
import type { OperationsMapData } from "@/lib/ai-operations-map/load-map-data";
import type { RoutingArchitectureMode } from "@/lib/ai-operations-map/routing-comparison-view-model";

const REFRESH_INTERVAL_MS = 45_000;
const SCRUB_SETTLE_MS = 600;
const SCRUB_POLL_HOLDOFF_MS = 5_000;
const SWAP_ECHO_IGNORE_MS = 1_200;
/** A fetched window whose end is this close to "now" is following the live edge. */
const LIVE_EDGE_SLACK_MS = 10 * 60_000;
/** Live-edge refetches extend past now so forecast/scheduled entries stay visible. */
const LIVE_EDGE_FORECAST_PAD_MS = 60 * 60_000;

export type EvidenceWindowMs = { start: number; end: number };

/**
 * Whether a requested evidence window differs enough from the one the current
 * data was fetched with to justify another round-trip. Tolerance absorbs the
 * padding/new-event drift the panel's republish carries after a data swap.
 * Exported for unit tests.
 */
export function windowMateriallyDiffers(
  previous: EvidenceWindowMs | null,
  next: EvidenceWindowMs,
): boolean {
  if (!previous) return true;
  const span = Math.max(next.end - next.start, previous.end - previous.start, 1);
  const tolerance = Math.max(60_000, span * 0.05);
  return (
    Math.abs(next.start - previous.start) > tolerance ||
    Math.abs(next.end - previous.end) > tolerance
  );
}

/** Human age label for the freshness bar. Exported for unit tests. */
export function formatRefreshAge(ageMs: number): string {
  if (ageMs < 15_000) return "just now";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 60 * 60_000) return `${Math.round(ageMs / 60_000)}m ago`;
  return `${Math.round(ageMs / (60 * 60_000))}h ago`;
}

export function OperationsMapLiveShell({
  initialData,
  initialArchitectureMode = "compare",
  initialFocusStageId = null,
}: {
  initialData: OperationsMapData;
  initialArchitectureMode?: RoutingArchitectureMode;
  initialFocusStageId?: string | null;
}) {
  const [data, setData] = useState(initialData);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const fetchedWindowRef = useRef<EvidenceWindowMs | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const swapAtRef = useRef(0);
  const scrubAtRef = useRef(0);
  const scrubTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUpdatedRef = useRef(0);

  const fetchSnapshot = useCallback(async (window: EvidenceWindowMs | null) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRefreshing(true);
    try {
      const params = window
        ? `?start=${Math.round(window.start)}&end=${Math.round(window.end)}`
        : "";
      const response = await fetch(`/api/platform/operations-map${params}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Refresh failed (${response.status})`);
      const next = (await response.json()) as OperationsMapData;
      fetchedWindowRef.current = window;
      swapAtRef.current = Date.now();
      lastUpdatedRef.current = Date.now();
      setData(next);
      setLastUpdatedAt(Date.now());
      setRefreshError(null);
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setRefreshError(error instanceof Error ? error.message : "Refresh failed");
      }
    } finally {
      if (abortRef.current === controller) {
        setRefreshing(false);
        abortRef.current = null;
      }
    }
  }, []);

  const refreshNow = useCallback(() => {
    const fetched = fetchedWindowRef.current;
    const now = Date.now();
    // Follow the live edge: when the current window reaches (or predates by
    // only a little) now, slide its end forward so fresh events land inside.
    // A window parked deep in history refetches as-is — a no-op data-wise,
    // but keeps the freshness indicator honest.
    const window = fetched
      ? fetched.end >= now - LIVE_EDGE_SLACK_MS
        ? { start: fetched.start, end: now + LIVE_EDGE_FORECAST_PAD_MS }
        : fetched
      : null;
    void fetchSnapshot(window);
  }, [fetchSnapshot]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - scrubAtRef.current < SCRUB_POLL_HOLDOFF_MS) return;
      refreshNow();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshNow]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) return;
      if (Date.now() - lastUpdatedRef.current < REFRESH_INTERVAL_MS) return;
      refreshNow();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refreshNow]);

  useEffect(
    () => () => {
      if (scrubTimerRef.current) clearTimeout(scrubTimerRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  const handleReplayWindowChange = useCallback(
    ({ start, end }: { time: number; start: number; end: number }) => {
      // The panel republishes its window right after every data swap (the
      // range recomputes from the new events); that echo is not a scrub.
      if (Date.now() - swapAtRef.current < SWAP_ECHO_IGNORE_MS) return;
      const next: EvidenceWindowMs = { start, end };
      if (!windowMateriallyDiffers(fetchedWindowRef.current, next)) return;
      scrubAtRef.current = Date.now();
      if (scrubTimerRef.current) clearTimeout(scrubTimerRef.current);
      scrubTimerRef.current = setTimeout(() => {
        void fetchSnapshot(next);
      }, SCRUB_SETTLE_MS);
    },
    [fetchSnapshot],
  );

  return (
    <div className="space-y-2">
      <OpsMapFreshnessBar
        lastUpdatedAt={lastUpdatedAt}
        refreshing={refreshing}
        error={refreshError}
        onRefresh={refreshNow}
      />
      <AiOperationsMap
        template={data.template}
        agents={data.agents}
        projections={data.projections}
        routingTopology={data.routingTopology}
        routingEvidence={data.routingEvidence}
        recentWindowLabel={data.recentWindowLabel}
        initialArchitectureMode={initialArchitectureMode}
        initialFocusStageId={initialFocusStageId}
        evidenceRange={data.evidenceRange}
        onReplayWindowChange={handleReplayWindowChange}
      />
    </div>
  );
}

/**
 * Freshness indicator + manual refresh. Its own component so the 10s "age"
 * ticker re-renders this strip alone, not the whole map tree.
 */
function OpsMapFreshnessBar({
  lastUpdatedAt,
  refreshing,
  error,
  onRefresh,
}: {
  lastUpdatedAt: number | null;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const ageLabel = lastUpdatedAt === null
    ? "showing the page-load snapshot"
    : `refreshed ${formatRefreshAge(Date.now() - lastUpdatedAt)}`;

  return (
    <div
      data-opsmap-freshness
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-xs text-[var(--dpf-muted)]"
    >
      <span aria-live="polite">
        {refreshing ? "Refreshing…" : `Live view · ${ageLabel} · auto-refresh every ${Math.round(REFRESH_INTERVAL_MS / 1000)}s`}
        {error ? (
          <span className="ml-2 text-[var(--dpf-error)]">Last refresh failed: {error}</span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--dpf-border)] px-2 py-1 font-medium text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)] disabled:opacity-50"
      >
        <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
        Refresh now
      </button>
    </div>
  );
}
