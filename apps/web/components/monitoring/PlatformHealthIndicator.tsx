"use client";

import { useState } from "react";

import {
  TONE_COLOR,
  getPlatformImpactAlerts,
  getTelemetryTargetAlerts,
  isTelemetryTargetAlert,
  type MonitoringAlert,
  type Tone,
} from "./health-summary";
import { useAlertQuery } from "./useAlertQuery";

type HealthState = "healthy" | "warning" | "critical" | "offline";

export function PlatformHealthIndicator() {
  const [open, setOpen] = useState(false);
  const { alerts: allAlerts, offline } = useAlertQuery();
  const platformAlerts = getPlatformImpactAlerts(allAlerts);
  const telemetryAlerts = getTelemetryTargetAlerts(allAlerts);
  const alerts = [...platformAlerts, ...telemetryAlerts];

  const health = deriveHealthState(offline, platformAlerts, telemetryAlerts);
  const dotTone = healthToTone(health);

  const label = healthLabel(health, platformAlerts.length, telemetryAlerts.length);

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
          <div className="fixed inset-0 z-[85]" onClick={() => setOpen(false)} />

          <div className="absolute right-0 top-full mt-1 z-[90] w-72 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] shadow-lg overflow-hidden">
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
                  const severity = alertDisplaySeverity(alert);
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

function deriveHealthState(
  offline: boolean,
  platformAlerts: MonitoringAlert[],
  telemetryAlerts: MonitoringAlert[],
): HealthState {
  if (offline) return "offline";
  if (platformAlerts.some((alert) => alert.labels.severity === "critical")) return "critical";
  if (platformAlerts.length > 0 || telemetryAlerts.length > 0) return "warning";
  return "healthy";
}

function healthToTone(health: HealthState): Tone {
  if (health === "healthy") return "success";
  if (health === "critical") return "critical";
  if (health === "warning") return "warning";
  return "neutral";
}

function healthLabel(
  health: HealthState,
  platformAlertCount: number,
  telemetryAlertCount: number,
): string {
  if (health === "healthy") return "All systems healthy";
  if (health === "offline") return "Monitoring offline";
  if (health === "critical") {
    return `${platformAlertCount} platform alert${platformAlertCount !== 1 ? "s" : ""} firing`;
  }
  if (platformAlertCount > 0) {
    return `${platformAlertCount} warning${platformAlertCount !== 1 ? "s" : ""}`;
  }
  return `${telemetryAlertCount} monitoring alert${telemetryAlertCount !== 1 ? "s" : ""}`;
}

function alertDisplaySeverity(alert: MonitoringAlert): "critical" | "warning" {
  if (isTelemetryTargetAlert(alert)) return "warning";
  return alert.labels.severity === "critical" ? "critical" : "warning";
}
