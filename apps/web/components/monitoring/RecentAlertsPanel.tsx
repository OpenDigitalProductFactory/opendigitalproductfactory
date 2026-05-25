"use client";

import { TONE_COLOR, type MonitoringAlert, type Tone } from "./health-summary";
import { useAlertQuery } from "./useAlertQuery";

export function RecentAlertsPanel() {
  const { alerts, offline } = useAlertQuery();

  return (
    <section>
      <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
        Recent Alerts
      </h3>

      {offline && (
        <p className="text-xs text-[var(--dpf-muted)]">Monitoring offline</p>
      )}

      {!offline && alerts.length === 0 && (
        <p className="text-xs text-[var(--dpf-success)]">No alerts</p>
      )}

      {!offline && alerts.length > 0 && (
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
          <table className="w-full text-xs">
            <tbody>
              {alerts.slice(0, 10).map((alert, i) => {
                const severity = alert.labels.severity ?? "warning";
                const tone = getAlertTone(alert);
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
                        className="text-[10px] font-bold uppercase"
                        style={{ color: TONE_COLOR[tone] }}
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

function getAlertTone(alert: MonitoringAlert): Tone {
  if (alert.state === "inactive") return "success";
  return alert.labels.severity === "critical" ? "critical" : "warning";
}
