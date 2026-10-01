// Prometheus alert shape and per-scrape-job presentation, shared by the
// monitoring UI (components/monitoring/health-summary.ts) and the attention
// source that humanizes health alerts (lib/observability/alert-humanize.ts).
// Lives in lib so lib code never imports components/** (M11 lib/ui layering).

export type MonitoringAlert = {
  labels: Record<string, string | undefined>;
  annotations: Record<string, string | undefined>;
  state: "firing" | "pending" | "inactive" | string;
  activeAt: string;
};

// Friendly display name + presentation hints per Prometheus scrape job.
// Used by deriveServiceStatusesFromTargets to dress up the raw job/instance
// strings the targets API returns. Jobs not in the map render with their
// raw job name (forward compatibility: adding a new scrape job auto-creates
// a tile, no UI change required — but the tile gets a friendlier name as a
// follow-up commit).
export type JobPresentation = {
  name: string;
  // Optional: tiles whose job appears in this map but with `hidden: true` are
  // dropped from the grid even when scraped. Use for jobs we expose for
  // alerting only (e.g. prometheus self-target) without cluttering the UI.
  hidden?: boolean;
  // Self-monitoring / internal targets. We still want the tile but tag it
  // visually so it doesn't read as a customer-facing surface.
  internal?: boolean;
};

export const JOB_PRESENTATION: Record<string, JobPresentation> = {
  portal: { name: "Portal" },
  sandbox: { name: "Sandbox" },
  postgres: { name: "PostgreSQL" },
  inngest: { name: "Inngest" },
  redis: { name: "Redis" },
  adp: { name: "ADP" },
  "dev-portal": { name: "Contributor Preview" },
  "windows-host": { name: "Windows Host", internal: true },
  "node-exporter": { name: "Node Exporter", internal: true },
  cadvisor: { name: "cAdvisor", internal: true },
  prometheus: { name: "Prometheus", hidden: true }, // self-monitoring; alert-only
};
