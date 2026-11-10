"use client";

import { useCallback, useEffect, useState } from "react";

import type { MonitoringAlert } from "@/lib/observability/monitoring-jobs";

type AlertQueryState = {
  alerts: MonitoringAlert[];
  loading: boolean;
  offline: boolean;
  /** No monitoring stack is configured on this install — neutral, not an outage
   *  (BI-63FF58D2). Distinct from `offline` (configured but unreachable). */
  notConfigured: boolean;
  /** Metric monitoring is switched off on this install; any alerts are from
   *  Loki, which is always on (BI-2CE9CBF4). */
  monitoringOff: boolean;
};

export function useAlertQuery(intervalMs = 30_000): AlertQueryState {
  const [state, setState] = useState<AlertQueryState>({
    alerts: [],
    loading: true,
    offline: false,
    notConfigured: false,
    monitoringOff: false,
  });

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/metrics/alerts", { cache: "no-store" });
      if (res.status === 503) {
        setState({ alerts: [], loading: false, offline: true, notConfigured: false, monitoringOff: false });
        return;
      }

      const json = await res.json();
      setState({
        alerts: json.data?.alerts ?? [],
        loading: false,
        offline: false,
        notConfigured: json.status === "not-configured",
        monitoringOff: json.status === "monitoring-off" || json.monitoring === "off",
      });
    } catch {
      setState({ alerts: [], loading: false, offline: true, notConfigured: false, monitoringOff: false });
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, intervalMs);
    return () => clearInterval(id);
  }, [fetchAlerts, intervalMs]);

  return state;
}
