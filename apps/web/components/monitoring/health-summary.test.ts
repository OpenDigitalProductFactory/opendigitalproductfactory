import { describe, expect, it } from "vitest";

import {
  HOST_RESOURCE_QUERIES,
  deriveMonitoringSummary,
  derivePlatformSummary,
  deriveServiceStatuses,
  isHostTelemetryConfigured,
  type MonitoringAlert,
  type PrometheusInstantResult,
  type ServiceDefinition,
} from "./health-summary";

function up(job: string, value: "0" | "1" = "1"): PrometheusInstantResult {
  return {
    metric: { job },
    value: [1, value],
  };
}

function alert(
  severity: "critical" | "warning",
  state: "firing" | "pending" | "inactive" = "firing",
  job = "node-exporter",
): MonitoringAlert {
  return {
    labels: { alertname: "ContainerDown", severity, job },
    annotations: { summary: `Service ${job} is down` },
    state,
    activeAt: "2026-05-25T15:29:00.000Z",
  };
}

describe("derivePlatformSummary", () => {
  it("reports critical instead of operational when required platform alerts are firing", () => {
    const summary = derivePlatformSummary({
      checked: true,
      online: true,
      upTargets: [up("prometheus"), up("portal"), up("postgres"), up("qdrant")],
      alerts: [alert("critical", "firing", "portal")],
    });

    expect(summary.value).toBe("Critical");
    expect(summary.tone).toBe("critical");
    expect(summary.detail).toContain("Service portal is down");
  });

  it("does not report platform critical when only telemetry exporter alerts are firing", () => {
    const summary = derivePlatformSummary({
      checked: true,
      online: true,
      upTargets: [up("prometheus"), up("portal"), up("postgres"), up("qdrant"), up("sandbox"), up("windows-host")],
      alerts: [alert("critical", "firing", "node-exporter"), alert("critical", "firing", "cadvisor")],
    });

    expect(summary.value).toBe("Operational");
    expect(summary.tone).toBe("success");
    expect(summary.detail).toContain("Required platform services are up");
  });
});

describe("deriveMonitoringSummary", () => {
  it("reports degraded telemetry when Prometheus is up but an exporter target is down", () => {
    const summary = deriveMonitoringSummary({
      checked: true,
      online: true,
      upTargets: [
        up("prometheus"),
        up("windows-host"),
        up("node-exporter", "0"),
        up("cadvisor", "0"),
      ],
      alerts: [alert("critical")],
    });

    expect(summary.value).toBe("Degraded");
    expect(summary.tone).toBe("warning");
    expect(summary.detail).toContain("2 telemetry targets down");
  });

  it("reports active when Prometheus and telemetry targets are healthy", () => {
    const summary = deriveMonitoringSummary({
      checked: true,
      online: true,
      upTargets: [up("prometheus"), up("windows-host"), up("cadvisor")],
      alerts: [],
    });

    expect(summary.value).toBe("Active");
    expect(summary.tone).toBe("success");
  });

  it("reports active (not degraded) on macOS where no host telemetry exporter is configured", () => {
    // macOS ships neither windows-host nor node-exporter — they are absent from
    // the scrape targets, not down. Absence is by design, not a degradation.
    const summary = deriveMonitoringSummary({
      checked: true,
      online: true,
      upTargets: [up("prometheus"), up("portal"), up("postgres"), up("qdrant"), up("sandbox")],
      alerts: [],
    });

    expect(summary.value).toBe("Active");
    expect(summary.tone).toBe("success");
    expect(summary.detail).not.toContain("Host telemetry is not available");
  });

  it("still reports degraded when a configured host telemetry exporter is down", () => {
    // Windows install whose windows_exporter has stopped: the job is a
    // configured scrape target reporting up=0, so the signal must survive.
    const summary = deriveMonitoringSummary({
      checked: true,
      online: true,
      upTargets: [up("prometheus"), up("portal"), up("windows-host", "0")],
      alerts: [],
    });

    expect(summary.value).toBe("Degraded");
    expect(summary.tone).toBe("warning");
    expect(summary.detail).toContain("Host telemetry is not available");
  });
});

describe("deriveServiceStatuses", () => {
  it("marks intentionally unmonitored services as not monitored instead of unknown", () => {
    const services: ServiceDefinition[] = [
      { name: "Portal", job: "portal" },
      { name: "AI Inference", statusHint: "Tracked by portal metrics" },
    ];

    const rows = deriveServiceStatuses({
      services,
      upTargets: [up("portal")],
      loading: false,
      offline: false,
    });

    expect(rows).toEqual([
      expect.objectContaining({ name: "Portal", state: "up", label: "UP" }),
      expect.objectContaining({
        name: "AI Inference",
        state: "not-monitored",
        label: "Tracked by portal metrics",
      }),
    ]);
  });

  it("hides optional services whose job is not a configured scrape target", () => {
    // Customer install: prometheus.yml does NOT have dev-portal as a target,
    // so the Contributor Preview tile must NOT render — otherwise customers
    // see a phantom DOWN tile they can never fix.
    const services: ServiceDefinition[] = [
      { name: "Portal", job: "portal" },
      { name: "Contributor Preview", job: "dev-portal", optional: true },
    ];

    const rows = deriveServiceStatuses({
      services,
      upTargets: [up("portal")],
      loading: false,
      offline: false,
    });

    expect(rows.map((r) => r.name)).toEqual(["Portal"]);
  });

  it("shows optional services once their job is a configured target", () => {
    // Contributor install with --profile dev: dev-portal appears in `up`.
    // The Contributor Preview tile must render and reflect the live state.
    const services: ServiceDefinition[] = [
      { name: "Portal", job: "portal" },
      { name: "Contributor Preview", job: "dev-portal", optional: true },
    ];

    const rows = deriveServiceStatuses({
      services,
      upTargets: [up("portal"), up("dev-portal")],
      loading: false,
      offline: false,
    });

    expect(rows).toEqual([
      expect.objectContaining({ name: "Portal", state: "up" }),
      expect.objectContaining({ name: "Contributor Preview", state: "up", label: "UP" }),
    ]);
  });

  it("keeps optional services visible while loading so they don't flicker on hydrate", () => {
    const services: ServiceDefinition[] = [
      { name: "Contributor Preview", job: "dev-portal", optional: true },
    ];

    const rows = deriveServiceStatuses({
      services,
      upTargets: null,
      loading: true,
      offline: false,
    });

    expect(rows).toEqual([
      expect.objectContaining({ name: "Contributor Preview", state: "loading" }),
    ]);
  });
});

describe("HOST_RESOURCE_QUERIES", () => {
  it("uses Windows exporter fallback queries for local Windows installs", () => {
    expect(HOST_RESOURCE_QUERIES.compute).toContain("windows_cpu_time_total");
    expect(HOST_RESOURCE_QUERIES.memory).toContain("windows_os_physical_memory_free_bytes");
    expect(HOST_RESOURCE_QUERIES.storage).toContain("windows_logical_disk_free_bytes");
  });
});

describe("isHostTelemetryConfigured", () => {
  it("is true when node-exporter is a scrape target", () => {
    expect(isHostTelemetryConfigured([up("node-exporter")])).toBe(true);
  });

  it("is true when windows-host is a scrape target, even if down", () => {
    expect(isHostTelemetryConfigured([up("windows-host", "0")])).toBe(true);
  });

  it("is false on macOS Docker Desktop (no host telemetry exporter ships)", () => {
    expect(
      isHostTelemetryConfigured([up("portal"), up("postgres"), up("qdrant"), up("sandbox")]),
    ).toBe(false);
  });

  it("is false for null/empty input", () => {
    expect(isHostTelemetryConfigured(null)).toBe(false);
    expect(isHostTelemetryConfigured(undefined)).toBe(false);
    expect(isHostTelemetryConfigured([])).toBe(false);
  });
});
