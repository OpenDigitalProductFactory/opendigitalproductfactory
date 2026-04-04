"use client";

import { useState, useEffect, useCallback } from "react";
import { useMonitoringStatus } from "./MonitoringContext";

export type PrometheusResult = {
  metric: Record<string, string>;
  value: [number, string]; // [timestamp, value]
};

type QueryState = {
  data: PrometheusResult[] | null;
  loading: boolean;
  error: string | null;
  offline: boolean;
};

const OFFLINE_STATE: QueryState = { data: null, loading: false, error: null, offline: true };

export function useMetricQuery(
  query: string,
  intervalMs = 15_000,
): QueryState {
  const { online, checked } = useMonitoringStatus();
  const [state, setState] = useState<QueryState>({
    data: null,
    loading: true,
    error: null,
    offline: false,
  });

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/platform/metrics?query=${encodeURIComponent(query)}`,
        { cache: "no-store" },
      );
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
  }, [query]);

  useEffect(() => {
    // Don't fire queries until connectivity is checked
    if (!checked) return;
    // If the shared probe says offline, skip all individual queries
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
