export type Tone = "success" | "warning" | "critical" | "neutral";

export type PrometheusInstantResult = {
  metric: Record<string, string | undefined>;
  value: [number, string];
};

// /api/v1/targets active-target entry. Used by the targets-driven Service
// Status grid so we can render one tile per *instance*, not per job — e.g.
// three sandboxes show as three tiles instead of collapsing onto one row.
export type PrometheusActiveTarget = {
  labels: { job?: string; instance?: string } & Record<string, string | undefined>;
  health: "up" | "down" | "unknown" | string;
  lastScrape?: string;
  lastScrapeDuration?: number;
  lastError?: string;
};

export type MonitoringAlert = {
  labels: Record<string, string | undefined>;
  annotations: Record<string, string | undefined>;
  state: "firing" | "pending" | "inactive" | string;
  activeAt: string;
};

export type HealthSummary = {
  value: string;
  tone: Tone;
  detail: string;
};

export type ServiceDefinition = {
  name: string;
  job?: string;
  detail?: string;
  statusHint?: string;
  // Optional services only render when their `job` actually appears in the
  // current Prometheus `up` results. Used for profile-gated targets like the
  // contributor preview (`dev-portal`): customer installs never load that
  // overlay, so the tile never renders for them — but contributors who run
  // `--profile dev` see it appear as soon as Prometheus picks it up.
  optional?: boolean;
};

export type ServiceStatus = ServiceDefinition & {
  state: "up" | "down" | "unknown" | "loading" | "offline" | "not-monitored";
  label: string;
  tone: Tone;
};

type SummaryInput = {
  checked: boolean;
  online: boolean;
  upTargets: PrometheusInstantResult[] | null | undefined;
  alerts: MonitoringAlert[];
  upTargetsLoading?: boolean;
};

type ServiceStatusInput = {
  services: ServiceDefinition[];
  upTargets: PrometheusInstantResult[] | null | undefined;
  loading: boolean;
  offline: boolean;
};

const PLATFORM_REQUIRED_JOBS = ["portal", "postgres", "qdrant", "sandbox"];
const TELEMETRY_JOBS = ["node-exporter", "cadvisor"];
const TELEMETRY_JOB_SET = new Set(TELEMETRY_JOBS);
// Host-hardware telemetry exporters, one per substrate (Windows / Linux).
// macOS ships none; their absence is expected, not a degradation.
const HOST_TELEMETRY_JOBS = ["windows-host", "node-exporter"];

export const HOST_RESOURCE_QUERIES = {
  compute:
    '(100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)) or (100 - (avg(rate(windows_cpu_time_total{mode="idle"}[5m])) * 100))',
  memory:
    "((1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100) or ((1 - windows_os_physical_memory_free_bytes / windows_cs_physical_memory_bytes) * 100)",
  storage:
    'max((1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100) or max((1 - windows_logical_disk_free_bytes{volume=~"[A-Z]:"} / windows_logical_disk_size_bytes{volume=~"[A-Z]:"}) * 100)',
};

export const TONE_COLOR: Record<Tone, string> = {
  success: "var(--dpf-success)",
  warning: "var(--dpf-warning)",
  critical: "var(--dpf-error)",
  neutral: "var(--dpf-muted)",
};

export function derivePlatformSummary({
  checked,
  online,
  upTargets,
  alerts,
  upTargetsLoading = false,
}: SummaryInput): HealthSummary {
  if (!checked || upTargetsLoading) {
    return { value: "Checking", tone: "neutral", detail: "Collecting current health signals" };
  }

  if (!online) {
    return { value: "Unavailable", tone: "critical", detail: "Monitoring stack is unreachable" };
  }

  const activeAlerts = getPlatformImpactAlerts(alerts);
  const criticalAlerts = activeAlerts.filter((alert) => alert.labels.severity === "critical");
  if (criticalAlerts.length > 0) {
    return {
      value: "Critical",
      tone: "critical",
      detail: alertSummary(criticalAlerts[0]) ?? `${criticalAlerts.length} critical alerts firing`,
    };
  }

  const jobStatus = buildJobStatusMap(upTargets);
  const downRequiredJobs = PLATFORM_REQUIRED_JOBS.filter((job) => jobStatus.get(job) === 0);
  if (downRequiredJobs.length > 0) {
    return {
      value: "Critical",
      tone: "critical",
      detail: `${downRequiredJobs.join(", ")} down`,
    };
  }

  const missingRequiredJobs = PLATFORM_REQUIRED_JOBS.filter((job) => !jobStatus.has(job));
  if (missingRequiredJobs.length > 0) {
    return {
      value: "Degraded",
      tone: "warning",
      detail: `${missingRequiredJobs.join(", ")} status unknown`,
    };
  }

  const warningAlerts = activeAlerts.filter((alert) => alert.labels.severity === "warning");
  if (warningAlerts.length > 0) {
    return {
      value: "Degraded",
      tone: "warning",
      detail: alertSummary(warningAlerts[0]) ?? `${warningAlerts.length} warning alerts firing`,
    };
  }

  return { value: "Operational", tone: "success", detail: "Required platform services are up" };
}

export function deriveMonitoringSummary({
  checked,
  online,
  upTargets,
  upTargetsLoading = false,
}: SummaryInput): HealthSummary {
  if (!checked || upTargetsLoading) {
    return { value: "Checking", tone: "neutral", detail: "Checking monitoring targets" };
  }

  if (!online) {
    return { value: "Offline", tone: "critical", detail: "Prometheus API is unreachable" };
  }

  const jobStatus = buildJobStatusMap(upTargets);
  if (jobStatus.get("prometheus") === 0) {
    return { value: "Offline", tone: "critical", detail: "Prometheus self-target is down" };
  }

  const telemetryDown = TELEMETRY_JOBS.filter((job) => jobStatus.get(job) === 0);
  if (telemetryDown.length > 0) {
    return {
      value: "Degraded",
      tone: "warning",
      detail: `${telemetryDown.length} telemetry targets down: ${telemetryDown.join(", ")}`,
    };
  }

  // Host telemetry exporters are substrate-specific: windows_exporter on
  // Windows (windows-host), node-exporter on Linux. macOS (Docker Desktop)
  // ships neither — the VM boundary hides the host's NICs — so their absence
  // is by design, not a degradation. Distinguish "configured but down" (a real
  // problem to flag) from "not configured on this substrate" (expected): a job
  // only appears in the `up` results when it is a configured scrape target.
  const hostTelemetryConfigured = HOST_TELEMETRY_JOBS.some((job) => jobStatus.has(job));
  const hostTelemetryUp = HOST_TELEMETRY_JOBS.some((job) => jobStatus.get(job) === 1);
  if (hostTelemetryConfigured && !hostTelemetryUp) {
    return { value: "Degraded", tone: "warning", detail: "Host telemetry is not available" };
  }

  if (!hostTelemetryConfigured) {
    return { value: "Active", tone: "success", detail: "Prometheus and platform services are healthy" };
  }

  return { value: "Active", tone: "success", detail: "Prometheus and telemetry targets are healthy" };
}

export function deriveServiceStatuses({
  services,
  upTargets,
  loading,
  offline,
}: ServiceStatusInput): ServiceStatus[] {
  const jobStatus = buildJobStatusMap(upTargets);

  const rows: ServiceStatus[] = [];
  for (const service of services) {
    // Optional services (e.g. profile-gated contributor preview) only render
    // when their job is a configured scrape target. We can't make this
    // determination while loading or offline, so we keep the row visible in
    // those transient states and only hide it once we have a real result and
    // confirm the job is absent.
    if (
      service.optional &&
      service.job &&
      !loading &&
      !offline &&
      !jobStatus.has(service.job)
    ) {
      continue;
    }

    if (offline) {
      rows.push({ ...service, state: "offline", label: "Offline", tone: "neutral" });
      continue;
    }

    if (loading) {
      rows.push({ ...service, state: "loading", label: "...", tone: "neutral" });
      continue;
    }

    if (!service.job) {
      rows.push({
        ...service,
        state: "not-monitored",
        label: service.statusHint ?? "Not monitored",
        tone: "neutral",
      });
      continue;
    }

    const status = jobStatus.get(service.job);
    if (status === 1) {
      rows.push({
        ...service,
        state: "up",
        label: service.detail ? `UP ${service.detail}` : "UP",
        tone: "success",
      });
      continue;
    }

    if (status === 0) {
      rows.push({ ...service, state: "down", label: "DOWN", tone: "critical" });
      continue;
    }

    rows.push({ ...service, state: "unknown", label: "Unknown", tone: "neutral" });
  }
  return rows;
}

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
  qdrant: { name: "Qdrant" },
  inngest: { name: "Inngest" },
  redis: { name: "Redis" },
  adp: { name: "ADP" },
  "dev-portal": { name: "Contributor Preview" },
  "windows-host": { name: "Windows Host", internal: true },
  "node-exporter": { name: "Node Exporter", internal: true },
  cadvisor: { name: "cAdvisor", internal: true },
  prometheus: { name: "Prometheus", hidden: true }, // self-monitoring; alert-only
};

// Services that have no Prometheus scrape target but the user should still
// see on the Health tab — either because they exist but ship without a
// /metrics endpoint (Neo4j Community, whisper-server), or because they're
// observable through a different channel (AI Inference + Voice STT both
// flow through portal application metrics on /api/metrics, not their own
// scrape job). These tiles render as neutral "Not scraped" / "Portal
// metrics" — the same pattern the older hardcoded grid used for Neo4j.
export const UNSCRAPED_SERVICES: ServiceDefinition[] = [
  { name: "Neo4j", statusHint: "Not scraped" },
  { name: "AI Inference", statusHint: "Portal metrics" },
  { name: "Voice STT", statusHint: "Portal metrics" },
];

// Targets-driven service status. Renders one row per active target, joined
// with JOB_PRESENTATION for friendly names. Falls back to the raw job string
// when a job isn't in the map.
//
// Per-instance: three sandboxes scrape targets in prometheus.yml -> three
// tiles, each labelled with its short instance name. That's how this design
// future-proofs multi-sandbox installs vs the old hardcoded list.
export function deriveServiceStatusesFromTargets({
  targets,
  loading,
  offline,
}: {
  targets: PrometheusActiveTarget[] | null | undefined;
  loading: boolean;
  offline: boolean;
}): ServiceStatus[] {
  if (offline) {
    return [];
  }
  if (loading) {
    // Don't flicker an empty grid on first paint — render a placeholder row
    // so the grid section keeps its height.
    return [
      { name: "Loading…", state: "loading", label: "...", tone: "neutral" },
    ];
  }

  // Group by job so we can disambiguate single-instance jobs (label as just
  // the friendly name) from multi-instance jobs (append an instance suffix).
  const byJob = new Map<string, PrometheusActiveTarget[]>();
  for (const t of targets ?? []) {
    const job = t.labels.job ?? "(no-job)";
    if (!byJob.has(job)) byJob.set(job, []);
    byJob.get(job)!.push(t);
  }

  const rows: ServiceStatus[] = [];
  for (const [job, instances] of byJob) {
    const presentation = JOB_PRESENTATION[job];
    if (presentation?.hidden) continue;
    const baseName = presentation?.name ?? job;
    const multi = instances.length > 1;

    for (const t of instances) {
      const name = multi ? `${baseName} (${shortInstance(t.labels.instance)})` : baseName;
      const def: ServiceDefinition = { name, job };
      if (t.health === "up") {
        rows.push({ ...def, state: "up", label: "UP", tone: "success" });
      } else if (t.health === "down") {
        rows.push({
          ...def,
          state: "down",
          // The most actionable thing the grid can show on a DOWN tile is
          // *why*; lastError is short enough to fit.
          label: t.lastError ? `DOWN: ${truncate(t.lastError, 40)}` : "DOWN",
          tone: "critical",
        });
      } else {
        rows.push({ ...def, state: "unknown", label: "Unknown", tone: "neutral" });
      }
    }
  }

  return rows;
}

function shortInstance(instance: string | undefined): string {
  if (!instance) return "?";
  // "sandbox:3000" -> "sandbox", "host.docker.internal:9182" -> "host.docker.internal"
  const colon = instance.indexOf(":");
  return colon === -1 ? instance : instance.slice(0, colon);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// True iff a host-telemetry exporter is a configured scrape target on this
// substrate. macOS Docker Desktop ships neither node-exporter nor
// windows_exporter, so the host gauges have no source — callers use this to
// hide the Host Resources section instead of rendering empty "No data" gauges.
export function isHostTelemetryConfigured(
  upTargets: PrometheusInstantResult[] | null | undefined,
): boolean {
  const jobStatus = buildJobStatusMap(upTargets);
  return HOST_TELEMETRY_JOBS.some((job) => jobStatus.has(job));
}

export function getActiveAlerts(alerts: MonitoringAlert[]): MonitoringAlert[] {
  return alerts.filter((alert) => alert.state === "firing" || alert.state === "pending");
}

export function getPlatformImpactAlerts(alerts: MonitoringAlert[]): MonitoringAlert[] {
  return getActiveAlerts(alerts).filter((alert) => !isTelemetryTargetAlert(alert));
}

export function getTelemetryTargetAlerts(alerts: MonitoringAlert[]): MonitoringAlert[] {
  return getActiveAlerts(alerts).filter(isTelemetryTargetAlert);
}

export function isTelemetryTargetAlert(alert: MonitoringAlert): boolean {
  const job = alert.labels.job;
  return alert.labels.alertname === "ContainerDown" && !!job && TELEMETRY_JOB_SET.has(job);
}

function buildJobStatusMap(results: PrometheusInstantResult[] | null | undefined): Map<string, number> {
  const jobStatus = new Map<string, number>();
  for (const result of results ?? []) {
    const job = result.metric.job;
    if (!job) continue;
    jobStatus.set(job, parseFloat(result.value[1]));
  }
  return jobStatus;
}

function alertSummary(alert: MonitoringAlert): string | undefined {
  return alert.annotations.summary ?? alert.labels.alertname;
}
