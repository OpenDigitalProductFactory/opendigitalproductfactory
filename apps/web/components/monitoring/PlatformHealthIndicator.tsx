"use client";

import { useState } from "react";

import { TONE_COLOR, getActiveAlerts, type MonitoringAlert, type Tone } from "./health-summary";
import { useAlertQuery } from "./useAlertQuery";

type HealthState = "healthy" | "warning" | "critical" | "offline";

export function PlatformHealthIndicator() {
  const [open, setOpen] = useState(false);
  const { alerts: allAlerts, offline } = useAlertQuery();
  const alerts = getActiveAlerts(allAlerts);

  const health = deriveHealthState(offline, alerts);
  const dotTone = healthToTone(health);

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
        <span
          className={`h-2 w-2 rounded-full ${health === "critical" ? "animate-pulse" : ""}`}
          style={{ backgroundColor: TONE_COLOR[dotTone] }}
          aria-hidden="true"
        />
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
              <span
                className={`h-2 w-2 rounded-full ${health === "critical" ? "animate-pulse" : ""}`}
                style={{ backgroundColor: TONE_COLOR[dotTone] }}
                aria-hidden="true"
              />
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
              <div className="px-3 py-4 text-center text-xs text-[var(--dpf-success)]">
                All systems operational
              </div>
            )}

            {alerts.length > 0 && (
              <div className="max-h-48 overflow-y-auto">
                {alerts.map((alert, i) => {
                  const severity = alert.labels.severity ?? "warning";
                  const tone = severity === "critical" ? "critical" : "warning";
                  return (
                    <div
                      key={i}
                      className="px-3 py-2 border-b border-[var(--dpf-border)] last:border-b-0"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[10px] font-bold uppercase"
                          style={{ color: TONE_COLOR[tone] }}
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

function deriveHealthState(offline: boolean, alerts: MonitoringAlert[]): HealthState {
  if (offline) return "offline";
  if (alerts.length === 0) return "healthy";
  return alerts.some((alert) => alert.labels.severity === "critical") ? "critical" : "warning";
}

function healthToTone(health: HealthState): Tone {
  if (health === "healthy") return "success";
  if (health === "critical") return "critical";
  if (health === "warning") return "warning";
  return "neutral";
}
