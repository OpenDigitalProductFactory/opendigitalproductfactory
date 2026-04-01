"use client";

import { useState, useEffect, useCallback } from "react";

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

export function useMetricQuery(
  query: string,
  intervalMs = 15_000,
): QueryState {
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
      );
      if (res.status === 503) {
        setState({ data: null, loading: false, error: null, offline: true });
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
      setState({ data: null, loading: false, error: null, offline: true });
    }
  }, [query]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, intervalMs);
    return () => clearInterval(id);
  }, [fetchData, intervalMs]);

  return state;
}
