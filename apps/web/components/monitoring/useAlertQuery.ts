"use client";

import { useCallback, useEffect, useState } from "react";

import type { MonitoringAlert } from "./health-summary";

type AlertQueryState = {
  alerts: MonitoringAlert[];
  loading: boolean;
  offline: boolean;
};

export function useAlertQuery(intervalMs = 30_000): AlertQueryState {
  const [state, setState] = useState<AlertQueryState>({
    alerts: [],
    loading: true,
    offline: false,
  });

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/metrics/alerts", { cache: "no-store" });
      if (res.status === 503) {
        setState({ alerts: [], loading: false, offline: true });
        return;
      }

      const json = await res.json();
      setState({
        alerts: json.data?.alerts ?? [],
        loading: false,
        offline: false,
      });
    } catch {
      setState({ alerts: [], loading: false, offline: true });
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, intervalMs);
    return () => clearInterval(id);
  }, [fetchAlerts, intervalMs]);

  return state;
}
