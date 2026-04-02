"use client";

// Lightweight platform health strip for the portfolio overview page.
// Polls the Prometheus alerts endpoint to show service status and alert count.
// Falls back gracefully when monitoring is offline (common in dev).

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type Alert = {
  labels: Record<string, string>;
  state: string;
};

type ServiceStatus = { name: string; up: boolean };

type HealthState = {
  checked: boolean;
  online: boolean;
  services: ServiceStatus[];
  firingAlerts: number;
  criticalAlerts: number;
};

const INITIAL: HealthState = {
  checked: false,
  online: false,
  services: [],
  firingAlerts: 0,
  criticalAlerts: 0,
};

const SERVICE_JOBS = [
  { name: "Portal", job: "portal" },
  { name: "PostgreSQL", job: "postgres" },
  { name: "Qdrant", job: "qdrant" },
  { name: "AI Inference", job: "model-runner" },
];

export function PlatformHealthStrip() {
  const [state, setState] = useState<HealthState>(INITIAL);

  const probe = useCallback(async () => {
    try {
      // Fetch service status and alerts in parallel
      const [upRes, alertRes] = await Promise.all([
        fetch("/api/platform/metrics?query=up", { signal: AbortSignal.timeout(3_000) }),
        fetch("/api/platform/metrics/alerts", { signal: AbortSignal.timeout(3_000) }),
      ]);

      if (!upRes.ok) {
        setState({ ...INITIAL, checked: true });
        return;
      }

      // Parse service status
      const upJson = await upRes.json();
      const results: Array<{ metric: { job?: string }; value: [number, string] }> =
        upJson.data?.result ?? [];
      const statusMap = new Map<string, number>();
      for (const r of results) {
        if (r.metric.job) statusMap.set(r.metric.job, parseFloat(r.value[1]));
      }
      const services = SERVICE_JOBS.map((s) => ({
        name: s.name,
        up: statusMap.get(s.job) === 1,
      }));

      // Parse alerts
      let firingAlerts = 0;
      let criticalAlerts = 0;
      if (alertRes.ok) {
        const alertJson = await alertRes.json();
        const firing: Alert[] = (alertJson.data?.alerts ?? []).filter(
          (a: Alert) => a.state === "firing",
        );
        firingAlerts = firing.length;
        criticalAlerts = firing.filter((a) => a.labels.severity === "critical").length;
      }

      setState({ checked: true, online: true, services, firingAlerts, criticalAlerts });
    } catch {
      setState({ ...INITIAL, checked: true });
    }
  }, []);

  useEffect(() => {
    probe();
    const id = setInterval(probe, 30_000);
    return () => clearInterval(id);
  }, [probe]);

  if (!state.checked) return null;

  if (!state.online) {
    return (
      <div className="mb-6 flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-xs text-[var(--dpf-muted)]">
        <span className="w-2 h-2 rounded-full bg-gray-400" />
        Platform monitoring offline
      </div>
    );
  }

  const allUp = state.services.every((s) => s.up);
  const downServices = state.services.filter((s) => !s.up);

  const stripColour = state.criticalAlerts > 0
    ? "border-red-500/40 bg-red-500/5"
    : state.firingAlerts > 0 || downServices.length > 0
      ? "border-yellow-500/40 bg-yellow-500/5"
      : "border-green-500/30 bg-green-500/5";

  return (
    <div className={`mb-6 flex items-center justify-between gap-3 px-3 py-2 rounded-lg border ${stripColour}`}>
      <div className="flex items-center gap-3">
        {/* Overall dot */}
        <span
          className={`w-2.5 h-2.5 rounded-full ${
            state.criticalAlerts > 0
              ? "bg-red-500 animate-pulse"
              : !allUp || state.firingAlerts > 0
                ? "bg-yellow-500"
                : "bg-green-500"
          }`}
        />

        {/* Service dots */}
        <div className="flex items-center gap-1.5">
          {state.services.map((s) => (
            <div key={s.name} className="flex items-center gap-1" title={`${s.name}: ${s.up ? "UP" : "DOWN"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${s.up ? "bg-green-500" : "bg-red-500"}`} />
              <span className="text-[10px] text-[var(--dpf-muted)]">{s.name}</span>
            </div>
          ))}
        </div>

        {/* Alert summary */}
        {state.firingAlerts > 0 && (
          <span className="text-[10px] font-medium text-yellow-500">
            {state.firingAlerts} alert{state.firingAlerts !== 1 ? "s" : ""} firing
          </span>
        )}
        {state.firingAlerts === 0 && allUp && (
          <span className="text-[10px] text-green-500">All systems operational</span>
        )}
        {downServices.length > 0 && state.firingAlerts === 0 && (
          <span className="text-[10px] text-yellow-500">
            {downServices.map((s) => s.name).join(", ")} down
          </span>
        )}
      </div>

      <Link
        href="/ops/health"
        className="text-[10px] text-[var(--dpf-accent)] hover:underline whitespace-nowrap"
      >
        Health Detail
      </Link>
    </div>
  );
}
