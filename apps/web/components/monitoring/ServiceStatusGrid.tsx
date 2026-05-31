"use client";

import { useMetricQuery } from "./useMetricQuery";
import { TONE_COLOR, deriveServiceStatuses, type ServiceDefinition } from "./health-summary";

type Props = {
  services: ServiceDefinition[];
  className?: string;
};

export function ServiceStatusGrid({ services, className = "" }: Props) {
  const { data, loading, offline } = useMetricQuery("up");
  const rows = deriveServiceStatuses({ services, upTargets: data, loading, offline });

  return (
    <div className={className}>
      <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
        Platform Services
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {rows.map((svc) => (
          <div
            key={svc.name}
            className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-center"
          >
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: TONE_COLOR[svc.tone] }}
              aria-hidden="true"
            />
            <span className="text-xs font-medium text-[var(--dpf-text)]">{svc.name}</span>
            <span className="text-[10px] leading-3 text-[var(--dpf-muted)]">{svc.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Prometheus scrapes exactly one sandbox target (see monitoring/prometheus/prometheus.yml).
// Past iterations rendered "Sandbox 1/2/3" — three cards reading the same
// `up{job="sandbox"}` series, which always moved in lockstep and implied
// multi-sandbox capacity that doesn't exist.
export const DPF_SERVICES: ServiceDefinition[] = [
  { name: "Portal", job: "portal" },
  { name: "PostgreSQL", job: "postgres" },
  { name: "Neo4j", statusHint: "Not scraped" },
  { name: "Qdrant", job: "qdrant" },
  { name: "AI Inference", statusHint: "Portal metrics" },
  { name: "Sandbox", job: "sandbox" },
];
