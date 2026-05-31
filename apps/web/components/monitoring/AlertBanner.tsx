"use client";

import { useState } from "react";

import { TONE_COLOR, getActiveAlerts } from "./health-summary";
import { useAlertQuery } from "./useAlertQuery";

type Props = {
  className?: string;
  // Alert summaries already represented elsewhere on the page (e.g. by the
  // Platform Status StatCard). The banner suppresses any matching alert so the
  // user doesn't see "Service sandbox is down" twice on the same screen.
  suppressSummaries?: string[];
};

export function AlertBanner({ className = "", suppressSummaries = [] }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const { alerts, offline } = useAlertQuery();

  const suppressed = new Set(suppressSummaries.filter(Boolean));
  const visibleAlerts = getActiveAlerts(alerts).filter((a) => {
    if (dismissed.has(a.labels.alertname ?? "")) return false;
    const summary = a.annotations.summary ?? a.labels.alertname ?? "";
    return !suppressed.has(summary);
  });

  if (offline || visibleAlerts.length === 0) return null;

  return (
    <div className={`space-y-1 ${className}`}>
      {visibleAlerts.map((alert) => {
        const name = alert.labels.alertname ?? "Unknown";
        const severity = alert.labels.severity ?? "warning";
        const summary = alert.annotations.summary ?? name;
        const isCritical = severity === "critical";
        const tone = isCritical ? "critical" : "warning";
        const color = TONE_COLOR[tone];

        return (
          <div
            key={name}
            className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
            style={{
              backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
              borderColor: `color-mix(in srgb, ${color} 35%, var(--dpf-border))`,
              color,
            }}
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
