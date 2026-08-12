"use client";

import { useCallback, useEffect, useState } from "react";

import type { MonitoringAlert } from "./health-summary";

type AlertQueryState = {
  alerts: MonitoringAlert[];
  loading: boolean;
  offline: boolean;
  /** No monitoring stack is configured on this install — neutral, not an outage
   *  (BI-63FF58D2). Distinct from `offline` (configured but unreachable). */
  notConfigured: boolean;
};

export function useAlertQuery(intervalMs = 30_000): AlertQueryState {
  const [state, setState] = useState<AlertQueryState>({
    alerts: [],
    loading: true,
    offline: false,
    notConfigured: false,
  });

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/metrics/alerts", { cache: "no-store" });
      if (res.status === 503) {
        setState({ alerts: [], loading: false, offline: true, notConfigured: false });
        return;
      }

      const json = await res.json();
      setState({
        alerts: json.data?.alerts ?? [],
        loading: false,
        offline: false,
        notConfigured: json.status === "not-configured",
      });
    } catch {
      setState({ alerts: [], loading: false, offline: true, notConfigured: false });
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, intervalMs);
    return () => clearInterval(id);
  }, [fetchAlerts, intervalMs]);

  return state;
}
