"use client";

// Live-refresh shell for the "Right Now" cockpit (BI-1A68257F / EP-FULL-OBS).
//
// Polls /api/platform/resource-pressure on a short interval (paused while the
// tab is hidden) and renders the volatile resource picture: Docker-VM memory
// pressure, where that memory is going (top containers + the model-runner /
// overhead bucket), and the local inference engine state. This is the "right
// now" lens the operator was missing — no scheduled/forecast rows, no topology.

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { ResourcePressureSnapshot } from "@/lib/platform-runtime/resource-pressure";

const REFRESH_INTERVAL_MS = 12_000;

/** Bytes → compact GiB/MiB. Exported for unit tests. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

/** Human age label for the freshness bar. Exported for unit tests. */
export function formatRefreshAge(ageMs: number): string {
  if (ageMs < 15_000) return "just now";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 60 * 60_000) return `${Math.round(ageMs / 60_000)}m ago`;
  return `${Math.round(ageMs / (60 * 60_000))}h ago`;
}

type PressureTone = "ok" | "warn" | "high";

/** Pressure banding. Exported for unit tests. */
export function pressureTone(pct: number): PressureTone {
  if (pct >= 85) return "high";
  if (pct >= 65) return "warn";
  return "ok";
}

const TONE_COLOR: Record<PressureTone, string> = {
  ok: "var(--dpf-success)",
  warn: "var(--dpf-warning)",
  high: "var(--dpf-error)",
};

export function RightNowLiveShell({
  initialData,
}: {
  initialData: ResourcePressureSnapshot;
}) {
  const [data, setData] = useState(initialData);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshNow = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRefreshing(true);
    try {
      const res = await fetch("/api/platform/resource-pressure", {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
      setData((await res.json()) as ResourcePressureSnapshot);
      setLastUpdatedAt(Date.now());
      setError(null);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "Refresh failed");
      }
    } finally {
      if (abortRef.current === controller) {
        setRefreshing(false);
        abortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      void refreshNow();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshNow]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <div className="space-y-3">
      <FreshnessBar
        lastUpdatedAt={lastUpdatedAt}
        refreshing={refreshing}
        error={error}
        onRefresh={() => void refreshNow()}
      />
      <MemoryHero memory={data.memory} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <MemoryBreakdown data={data} />
        <LocalInferenceCard data={data} />
      </div>
    </div>
  );
}

function FreshnessBar({
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
    const id = setInterval(() => setTick((v) => v + 1), 5_000);
    return () => clearInterval(id);
  }, []);
  const ageLabel =
    lastUpdatedAt === null
      ? "showing the page-load snapshot"
      : `refreshed ${formatRefreshAge(Date.now() - lastUpdatedAt)}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-xs text-[var(--dpf-muted)]">
      <span aria-live="polite">
        {refreshing
          ? "Refreshing…"
          : `Live · ${ageLabel} · auto-refresh every ${Math.round(REFRESH_INTERVAL_MS / 1000)}s`}
        {error ? <span className="ml-2 text-[var(--dpf-error)]">Last refresh failed: {error}</span> : null}
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

function MemoryHero({ memory }: { memory: ResourcePressureSnapshot["memory"] }) {
  if (!memory.available) {
    return (
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]">
        Docker-VM memory telemetry is unavailable on this install (the portal
        could not read <code>/proc/meminfo</code>). Container-level figures below
        stand alone where present.
      </div>
    );
  }
  const tone = pressureTone(memory.pressurePct);
  const color = TONE_COLOR[tone];
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
            Docker VM memory
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold" style={{ color }}>
              {memory.pressurePct}%
            </span>
            <span className="text-sm text-[var(--dpf-muted)]">
              {formatBytes(memory.vmUsedBytes)} used of {formatBytes(memory.vmTotalBytes)} ·{" "}
              {formatBytes(memory.vmAvailableBytes)} free
            </span>
          </div>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
          style={{ background: "var(--dpf-surface-2)", color }}
        >
          {tone === "high" ? "High pressure" : tone === "warn" ? "Elevated" : "Healthy"}
        </span>
      </div>
      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-[var(--dpf-surface-2)]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, memory.pressurePct)}%`, background: color }}
        />
      </div>
      <p className="mt-2 text-xs text-[var(--dpf-muted)]">
        This is the WSL/Docker VM ceiling, not your Windows host total — the VM is
        capped well below physical RAM, so a high Windows figure is mostly other
        apps, not this stack.
      </p>
    </div>
  );
}

function MemoryBreakdown({ data }: { data: ResourcePressureSnapshot }) {
  const vmTotal = data.memory.available ? data.memory.vmTotalBytes : null;
  const other = data.memory.available ? data.memory.otherBytes : null;
  const top = data.containers.slice(0, 6);
  const maxBar = Math.max(
    ...top.map((c) => c.memBytes),
    other ?? 0,
    1,
  );

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Where the memory is</h2>
      <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">
        Top containers by working set{data.containersTruncated ? " (list truncated)" : ""}.
      </p>
      <ul className="mt-3 space-y-2">
        {top.map((c) => (
          <li key={c.id}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-medium text-[var(--dpf-text)]" title={c.name}>
                {c.name}
              </span>
              <span className="shrink-0 text-[var(--dpf-muted)]">
                {formatBytes(c.memBytes)}
                {c.cpuPct !== null ? ` · ${c.cpuPct}% CPU` : ""}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--dpf-surface-2)]">
              <div
                className="h-full rounded-full bg-[var(--dpf-accent)]"
                style={{ width: `${(c.memBytes / maxBar) * 100}%` }}
              />
            </div>
          </li>
        ))}
        {other !== null && other > 0 ? (
          <li>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-[var(--dpf-text)]">
                Model runner + VM overhead
              </span>
              <span className="shrink-0 text-[var(--dpf-muted)]">{formatBytes(other)}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--dpf-surface-2)]">
              <div
                className="h-full rounded-full bg-[var(--dpf-warning)]"
                style={{ width: `${(other / maxBar) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">
              Not attributable to a container — this is where a loaded local model
              shows up (it runs outside the container set).
            </p>
          </li>
        ) : null}
        {top.length === 0 ? (
          <li className="text-xs text-[var(--dpf-muted)]">
            No container stats available (Docker socket not reachable).
          </li>
        ) : null}
      </ul>
      {vmTotal ? null : (
        <p className="mt-2 text-[11px] text-[var(--dpf-muted)]">
          VM total unknown, so shares are shown as absolute bytes.
        </p>
      )}
    </section>
  );
}

function LocalInferenceCard({ data }: { data: ResourcePressureSnapshot }) {
  const { localModel } = data;
  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Local inference engine</h2>
      {!localModel.reachable ? (
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">
          No Docker Model Runner detected on this install — inference is cloud-routed.
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
              style={{
                background: "var(--dpf-surface-2)",
                color: localModel.engineRunning ? "var(--dpf-success)" : "var(--dpf-muted)",
              }}
            >
              {localModel.engineRunning ? "● Engine running" : "Engine idle"}
            </span>
            <span className="text-xs text-[var(--dpf-muted)]">llama.cpp backend</span>
          </div>
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
            Models available locally
          </div>
          <ul className="mt-1 space-y-1">
            {localModel.models.length === 0 ? (
              <li className="text-xs text-[var(--dpf-muted)]">None pulled.</li>
            ) : (
              localModel.models.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-[var(--dpf-text)]" title={m.id}>
                    {m.label}
                  </span>
                  <span className="shrink-0 text-[var(--dpf-muted)]">
                    {m.sizeBytes !== null ? `${formatBytes(m.sizeBytes)} when loaded` : "size unknown"}
                  </span>
                </li>
              ))
            )}
          </ul>
          <p className="mt-2 text-[11px] text-[var(--dpf-muted)]">
            A model loads on demand and self-unloads when idle — watch the “model
            runner + VM overhead” bucket rise and fall as it does.
          </p>
        </>
      )}
    </section>
  );
}
