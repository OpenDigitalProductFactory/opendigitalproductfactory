"use client";

import { useState, useEffect, useCallback } from "react";

type Alert = {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: string;
};

type HealthState = "healthy" | "warning" | "critical" | "offline";

export function PlatformHealthIndicator() {
  const [health, setHealth] = useState<HealthState>("offline");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/platform/metrics/alerts", {
        signal: AbortSignal.timeout(3_000),
      });
      if (res.status === 503) {
        setHealth("offline");
        setAlerts([]);
        return;
      }
      const json = await res.json();
      const firing: Alert[] = (json.data?.alerts ?? []).filter(
        (a: Alert) => a.state === "firing",
      );
      setAlerts(firing);

      if (firing.length === 0) {
        setHealth("healthy");
      } else if (firing.some((a) => a.labels.severity === "critical")) {
        setHealth("critical");
      } else {
        setHealth("warning");
      }
    } catch {
      setHealth("offline");
      setAlerts([]);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, 30_000);
    return () => clearInterval(id);
  }, [fetchHealth]);

  const dotColor = {
    healthy: "bg-green-500",
    warning: "bg-yellow-500",
    critical: "bg-red-500 animate-pulse",
    offline: "bg-gray-400",
  }[health];

  const label = {
    healthy: "All systems healthy",
    warning: `${alerts.length} warning${alerts.length !== 1 ? "s" : ""}`,
    critical: `${alerts.length} alert${alerts.length !== 1 ? "s" : ""} firing`,
    offline: "Monitoring offline",
  }[health];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-[var(--dpf-surface-2)] transition-colors"
        title={label}
      >
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        {health !== "healthy" && health !== "offline" && (
          <span className="text-[10px] text-[var(--dpf-muted)]">
            {alerts.length > 0 ? alerts.length : ""}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] shadow-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-[var(--dpf-border)] flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--dpf-text)]">Platform Health</span>
              <span className={`w-2 h-2 rounded-full ${dotColor}`} />
            </div>

            {health === "offline" && (
              <div className="px-3 py-4 text-xs text-[var(--dpf-muted)] text-center">
                Health data unavailable.
                <br />
                <span className="text-[10px]">
                  Monitoring services may still be starting up.
                </span>
              </div>
            )}

            {health === "healthy" && (
              <div className="px-3 py-4 text-xs text-green-500 text-center">
                All systems operational
              </div>
            )}

            {alerts.length > 0 && (
              <div className="max-h-48 overflow-y-auto">
                {alerts.map((alert, i) => {
                  const severity = alert.labels.severity ?? "warning";
                  return (
                    <div
                      key={i}
                      className="px-3 py-2 border-b border-[var(--dpf-border)] last:border-b-0"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-bold uppercase ${
                            severity === "critical" ? "text-red-400" : "text-yellow-400"
                          }`}
                        >
                          {severity}
                        </span>
                        <span className="text-xs text-[var(--dpf-text)]">
                          {alert.labels.alertname}
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5">
                        {alert.annotations.summary ?? ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            <a
              href="/ops/health"
              className="block px-3 py-2 text-xs text-[var(--dpf-accent)] hover:bg-[var(--dpf-surface-2)] border-t border-[var(--dpf-border)]"
              onClick={() => setOpen(false)}
            >
              Open System Health
            </a>
          </div>
        </>
      )}
    </div>
  );
}
