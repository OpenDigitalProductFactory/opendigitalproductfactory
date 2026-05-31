"use client";

import { useMetricQuery } from "./useMetricQuery";
import { useTargetsQuery } from "./useTargetsQuery";
import {
  TONE_COLOR,
  UNSCRAPED_SERVICES,
  deriveServiceStatuses,
  deriveServiceStatusesFromTargets,
  type ServiceDefinition,
} from "./health-summary";

type Props = {
  // Optional override — callers can still pass their own service list (the
  // legacy hardcoded shape). When omitted, the grid uses the targets-driven
  // path: one tile per active scrape target, plus the canonical
  // UNSCRAPED_SERVICES (Neo4j, AI Inference, Voice STT) appended.
  services?: ServiceDefinition[];
  className?: string;
};

export function ServiceStatusGrid({ services, className = "" }: Props) {
  // Legacy code path: when an explicit `services` array is passed in, render
  // it exactly the way SystemHealthDashboard used to. Used as the fallback
  // when callers haven't migrated yet.
  if (services) {
    return <LegacyServiceStatusGrid services={services} className={className} />;
  }

  return <TargetsDrivenServiceStatusGrid className={className} />;
}

function LegacyServiceStatusGrid({
  services,
  className,
}: {
  services: ServiceDefinition[];
  className: string;
}) {
  const { data, loading, offline } = useMetricQuery("up");
  const rows = deriveServiceStatuses({ services, upTargets: data, loading, offline });
  return <Grid rows={rows} className={className} />;
}

function TargetsDrivenServiceStatusGrid({ className }: { className: string }) {
  const { targets, loading, offline } = useTargetsQuery();
  const scraped = deriveServiceStatusesFromTargets({ targets, loading, offline });
  // Append the canonical "exists but unscraped" tiles unconditionally — they
  // don't depend on Prometheus targets data.
  const unscraped = UNSCRAPED_SERVICES.map((svc) => ({
    ...svc,
    state: "not-monitored" as const,
    label: svc.statusHint ?? "Not monitored",
    tone: "neutral" as const,
  }));
  const rows = [...scraped, ...unscraped];
  return <Grid rows={rows} className={className} />;
}

function Grid({
  rows,
  className,
}: {
  rows: Array<{ name: string; label: string; tone: keyof typeof TONE_COLOR }>;
  className: string;
}) {
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

// Legacy hardcoded service list. Kept as a re-export so out-of-tree consumers
// (none in-repo) don't break — but new code should use the targets-driven
// grid (call <ServiceStatusGrid /> with no `services` prop) instead. The
// presentation layer lives in JOB_PRESENTATION / UNSCRAPED_SERVICES in
// health-summary.ts; adding a scrape job there + naming it in
// JOB_PRESENTATION is now the only step needed to surface a new tile.
export const DPF_SERVICES: ServiceDefinition[] = [
  { name: "Portal", job: "portal" },
  { name: "PostgreSQL", job: "postgres" },
  { name: "Neo4j", statusHint: "Not scraped" },
  { name: "Qdrant", job: "qdrant" },
  { name: "AI Inference", statusHint: "Portal metrics" },
  { name: "Sandbox", job: "sandbox" },
  { name: "Inngest", job: "inngest" },
  { name: "Redis", job: "redis" },
  { name: "ADP", job: "adp" },
  { name: "Voice STT", statusHint: "Portal metrics" },
  { name: "Contributor Preview", job: "dev-portal", optional: true },
];
