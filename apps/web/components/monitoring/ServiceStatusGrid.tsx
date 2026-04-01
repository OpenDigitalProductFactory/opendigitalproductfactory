"use client";

import { useMetricQuery } from "./useMetricQuery";

type ServiceDef = {
  name: string;
  job: string;
  detail?: string;
};

type Props = {
  services: ServiceDef[];
  className?: string;
};

export function ServiceStatusGrid({ services, className = "" }: Props) {
  // Query all targets at once
  const { data, loading, offline } = useMetricQuery("up");

  // Build a map: job → up/down
  const statusMap = new Map<string, number>();
  if (data) {
    for (const result of data) {
      const job = result.metric.job;
      if (job) statusMap.set(job, parseFloat(result.value[1]));
    }
  }

  return (
    <div className={className}>
      <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
        Platform Services
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {services.map((svc) => {
          const up = statusMap.get(svc.job);
          const isUp = up === 1;
          const isDown = up === 0;
          const unknown = up === undefined;

          const dotColor = offline || loading
            ? "bg-gray-400"
            : isUp
              ? "bg-green-500"
              : isDown
                ? "bg-red-500"
                : unknown
                  ? "bg-gray-400"
                  : "bg-yellow-500";

          const statusText = offline
            ? "Offline"
            : loading
              ? "..."
              : isUp
                ? "UP"
                : isDown
                  ? "DOWN"
                  : "Unknown";

          return (
            <div
              key={svc.job}
              className="flex flex-col items-center gap-1 p-2 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]"
            >
              <span className={`w-3 h-3 rounded-full ${dotColor}`} />
              <span className="text-xs font-medium text-[var(--dpf-text)]">{svc.name}</span>
              <span className="text-[10px] text-[var(--dpf-muted)]">
                {statusText}
                {svc.detail && isUp ? ` ${svc.detail}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const DPF_SERVICES: ServiceDef[] = [
  { name: "Portal", job: "portal" },
  { name: "PostgreSQL", job: "postgres" },
  { name: "Neo4j", job: "neo4j" },
  { name: "Qdrant", job: "qdrant" },
  { name: "AI Inference", job: "model-runner" },
  { name: "Sandbox 1", job: "sandbox" },
  { name: "Sandbox 2", job: "sandbox" },
  { name: "Sandbox 3", job: "sandbox" },
];
