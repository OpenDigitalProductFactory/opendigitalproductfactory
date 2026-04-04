"use client";

import { useState, useEffect, useCallback } from "react";
import { useMonitoringStatus } from "./MonitoringContext";

export type RangeResult = {
  metric: Record<string, string>;
  values: [number, string][]; // [[timestamp, value], ...]
};

type RangeQueryState = {
  data: RangeResult[] | null;
  loading: boolean;
  error: string | null;
  offline: boolean;
};

const OFFLINE_STATE: RangeQueryState = { data: null, loading: false, error: null, offline: true };

export function useMetricRangeQuery(
  query: string,
  duration = "1h",
  step = "15s",
  intervalMs = 30_000,
): RangeQueryState {
  const { online, checked } = useMonitoringStatus();
  const [state, setState] = useState<RangeQueryState>({
    data: null,
    loading: true,
    error: null,
    offline: false,
  });

  const fetchData = useCallback(async () => {
    const now = Math.floor(Date.now() / 1000);
    const durationSeconds = parseDuration(duration);
    const start = now - durationSeconds;

    try {
      const params = new URLSearchParams({
        query,
        type: "range",
        start: start.toString(),
        end: now.toString(),
        step,
      });
      const res = await fetch(`/api/platform/metrics?${params}`, { cache: "no-store" });
      if (res.status === 503) {
        setState(OFFLINE_STATE);
        return;
      }
      const json = await res.json();
      if (json.status === "success") {
        setState({
          data: json.data?.result ?? [],
          loading: false,
          error: null,
          offline: false,
        });
      } else {
        setState({
          data: null,
          loading: false,
          error: json.error ?? "Query failed",
          offline: false,
        });
      }
    } catch {
      setState(OFFLINE_STATE);
    }
  }, [query, duration, step]);

  useEffect(() => {
    if (!checked) return;
    if (!online) {
      setState(OFFLINE_STATE);
      return;
    }

    fetchData();
    const id = setInterval(fetchData, intervalMs);
    return () => clearInterval(id);
  }, [fetchData, intervalMs, online, checked]);

  return state;
}

function parseDuration(d: string): number {
  const match = d.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 3600;
  const val = parseInt(match[1]!, 10);
  switch (match[2]) {
    case "s": return val;
    case "m": return val * 60;
    case "h": return val * 3600;
    case "d": return val * 86400;
    default: return 3600;
  }
}
