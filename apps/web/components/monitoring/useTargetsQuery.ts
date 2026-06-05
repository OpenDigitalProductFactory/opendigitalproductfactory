"use client";

import { useCallback, useEffect, useState } from "react";

import type { PrometheusActiveTarget } from "./health-summary";

type TargetsQueryState = {
  targets: PrometheusActiveTarget[];
  loading: boolean;
  offline: boolean;
};

// Mirror of useAlertQuery for /api/v1/targets. Pollable at the same cadence —
// targets list changes only when a scrape config reloads, but health
// (up/down/unknown) flips on every interval, so we re-fetch on a normal cycle.
export function useTargetsQuery(intervalMs = 30_000): TargetsQueryState {
  const [state, setState] = useState<TargetsQueryState>({
    targets: [],
    loading: true,
    offline: false,
  });

  const fetchTargets = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/metrics/targets", { cache: "no-store" });
      if (res.status === 503) {
        setState({ targets: [], loading: false, offline: true });
        return;
      }

      const json = await res.json();
      setState({
        targets: json.data?.activeTargets ?? [],
        loading: false,
        offline: false,
      });
    } catch {
      setState({ targets: [], loading: false, offline: true });
    }
  }, []);

  useEffect(() => {
    fetchTargets();
    const id = setInterval(fetchTargets, intervalMs);
    return () => clearInterval(id);
  }, [fetchTargets, intervalMs]);

  return state;
}
