"use client";

import { useState, useEffect, useCallback } from "react";

type Alert = {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: string;
  activeAt: string;
};

export function RecentAlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [offline, setOffline] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/metrics/alerts");
      if (res.status === 503) {
        setOffline(true);
        return;
      }
      const json = await res.json();
      setOffline(false);
      setAlerts(json.data?.alerts ?? []);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, 30_000);
    return () => clearInterval(id);
  }, [fetchAlerts]);

  return (
    <section>
      <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
        Recent Alerts
      </h3>

      {offline && (
        <p className="text-xs text-[var(--dpf-muted)]">Monitoring offline</p>
      )}

      {!offline && alerts.length === 0 && (
        <p className="text-xs text-green-500">No alerts</p>
      )}

      {!offline && alerts.length > 0 && (
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <tbody>
              {alerts.slice(0, 10).map((alert, i) => {
                const severity = alert.labels.severity ?? "warning";
                const isCritical = severity === "critical";
                const time = alert.activeAt
                  ? new Date(alert.activeAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "";

                return (
                  <tr
                    key={i}
                    className="border-t border-[var(--dpf-border)] first:border-t-0"
                  >
                    <td className="px-3 py-1.5 text-[var(--dpf-muted)] w-14">
                      {time}
                    </td>
                    <td className="px-2 py-1.5 w-16">
                      <span
                        className={`text-[10px] font-bold uppercase ${
                          isCritical ? "text-red-400" : alert.state === "firing" ? "text-yellow-400" : "text-green-500"
                        }`}
                      >
                        {alert.state === "firing"
                          ? severity.toUpperCase()
                          : "RESOLVED"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-[var(--dpf-text)]">
                      {alert.labels.alertname}
                    </td>
                    <td className="px-3 py-1.5 text-[var(--dpf-muted)]">
                      {alert.annotations.summary ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
