"use client";

import { useState, useEffect, useCallback } from "react";

type Alert = {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: "firing" | "pending" | "inactive";
  activeAt: string;
};

type Props = {
  className?: string;
};

export function AlertBanner({ className = "" }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [offline, setOffline] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/metrics/alerts");
      if (res.status === 503) {
        setOffline(true);
        setAlerts([]);
        return;
      }
      const json = await res.json();
      setOffline(false);
      const firing = (json.data?.alerts ?? []).filter(
        (a: Alert) => a.state === "firing" || a.state === "pending",
      );
      setAlerts(firing);
    } catch {
      setOffline(true);
      setAlerts([]);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const id = setInterval(fetchAlerts, 30_000);
    return () => clearInterval(id);
  }, [fetchAlerts]);

  const visibleAlerts = alerts.filter(
    (a) => !dismissed.has(a.labels.alertname ?? ""),
  );

  if (offline || visibleAlerts.length === 0) return null;

  return (
    <div className={`space-y-1 ${className}`}>
      {visibleAlerts.map((alert) => {
        const name = alert.labels.alertname ?? "Unknown";
        const severity = alert.labels.severity ?? "warning";
        const summary = alert.annotations.summary ?? name;
        const isCritical = severity === "critical";

        return (
          <div
            key={name}
            className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs ${
              isCritical
                ? "bg-red-500/10 border border-red-500/30 text-red-400"
                : "bg-yellow-500/10 border border-yellow-500/30 text-yellow-400"
            }`}
          >
            <span>
              <span className="font-semibold uppercase mr-2">{severity}</span>
              {summary}
            </span>
            <button
              onClick={() => setDismissed((prev) => new Set(prev).add(name))}
              className="ml-2 opacity-60 hover:opacity-100 transition-opacity"
            >
              Dismiss
            </button>
          </div>
        );
      })}
    </div>
  );
}
