import { describe, expect, it } from "vitest";

import {
  HOST_RESOURCE_QUERIES,
  deriveMonitoringSummary,
  derivePlatformSummary,
  deriveServiceStatuses,
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
});

describe("HOST_RESOURCE_QUERIES", () => {
  it("uses Windows exporter fallback queries for local Windows installs", () => {
    expect(HOST_RESOURCE_QUERIES.compute).toContain("windows_cpu_time_total");
    expect(HOST_RESOURCE_QUERIES.memory).toContain("windows_os_physical_memory_free_bytes");
    expect(HOST_RESOURCE_QUERIES.storage).toContain("windows_logical_disk_free_bytes");
  });
});
