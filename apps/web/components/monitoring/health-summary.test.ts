import { describe, expect, it } from "vitest";

import {
  HOST_RESOURCE_QUERIES,
  deriveMonitoringSummary,
  derivePlatformSummary,
  deriveServiceStatuses,
  deriveServiceStatusesFromTargets,
  friendlyJobLabel,
  humanizeJobList,
  isHostTelemetryConfigured,
  type MonitoringAlert,
  type PrometheusActiveTarget,
  type PrometheusInstantResult,
  type ServiceDefinition,
} from "./health-summary";
import type {
  CapabilityHealthAggregate,
  CapabilityHealthState,
  CapabilityServiceHealthProjection,
} from "@/lib/platform-runtime/service-health";

function capabilityHealth(
  state: CapabilityHealthState,
  aggregate: CapabilityHealthAggregate,
): CapabilityServiceHealthProjection {
  return {
    items: [
      {
        key: "example",
        kind: "service",
        state,
        availability: state === "optional_inactive" ? "inactive" : "unavailable",
        label: state,
        action: "Inspect the service.",
        tone: state === "optional_inactive" ? "neutral" : "warning",
        healthSemantics: "compose-healthcheck",
      },
    ],
    aggregate,
  };
}

function target(
  job: string,
  instance: string,
  health: "up" | "down" | "unknown" = "up",
  extra: Partial<PrometheusActiveTarget> = {},
): PrometheusActiveTarget {
  return {
    labels: { job, instance },
    health,
    ...extra,
  };
}

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
      capabilityHealth: capabilityHealth("required", {
        value: "Operational",
        tone: "success",
        detail: "Required platform services are available",
      }),
      alerts: [alert("critical", "firing", "portal")],
    });

    expect(summary.value).toBe("Critical");
    expect(summary.tone).toBe("critical");
    expect(summary.detail).toContain("Service portal is down");
  });

  it("does not degrade aggregate health for an intentionally inactive optional service", () => {
    const summary = derivePlatformSummary({
      checked: true,
      online: true,
      capabilityHealth: capabilityHealth("optional_inactive", {
        value: "Operational",
        tone: "success",
        detail: "Required platform services are available",
      }),
      alerts: [alert("critical", "firing", "node-exporter"), alert("critical", "firing", "cadvisor")],
    });

    expect(summary.value).toBe("Operational");
    expect(summary.tone).toBe("success");
    expect(summary.detail).toContain("Required platform services are available");
  });

  it("reports a missing required service from the capability projection", () => {
    const summary = derivePlatformSummary({
      checked: true,
      online: true,
      capabilityHealth: capabilityHealth("required", {
        value: "Degraded",
        tone: "warning",
        detail: "portal requires attention",
      }),
      alerts: [],
    });

    expect(summary).toEqual({
      value: "Degraded",
      tone: "warning",
      detail: "portal requires attention",
    });
  });

  it("reports an enabled optional-degraded service from the capability projection", () => {
    const summary = derivePlatformSummary({
      checked: true,
      online: true,
      capabilityHealth: capabilityHealth("optional_degraded", {
        value: "Degraded",
        tone: "warning",
        detail: "browser-use requires attention",
      }),
      alerts: [],
    });

    expect(summary.value).toBe("Degraded");
    expect(summary.detail).toBe("browser-use requires attention");
  });
});

describe("friendlyJobLabel / humanizeJobList", () => {
  it("maps known jobs to plain-language labels", () => {
    expect(friendlyJobLabel("postgres")).toBe("Database");
    expect(friendlyJobLabel("inngest")).toBe("Background jobs");
    expect(friendlyJobLabel("sandbox")).toBe("Build workspace");
  });

  it("falls back to the raw job id for an unmapped job (never crashes)", () => {
    expect(friendlyJobLabel("some-new-scrape-job")).toBe("some-new-scrape-job");
  });

  it("joins with 'and'/Oxford comma", () => {
    expect(humanizeJobList(["portal"])).toBe("Web portal");
    expect(humanizeJobList(["portal", "postgres"])).toBe("Web portal and Database");
    expect(humanizeJobList(["portal", "postgres", "sandbox"])).toBe(
      "Web portal, Database, and Build workspace",
    );
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
    // Humanized: plain "Host metrics"/"Container metrics", not raw job ids.
    expect(summary.detail).toContain("Host metrics");
    expect(summary.detail).toContain("Container metrics");
    expect(summary.detail).toContain("unavailable");
    expect(summary.detail).not.toContain("node-exporter");
    expect(summary.detail).not.toContain("cadvisor");
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

describe("deriveServiceStatusesFromTargets", () => {
  it("maps active up targets to friendly named tiles", () => {
    const rows = deriveServiceStatusesFromTargets({
      targets: [
        target("portal", "portal:3000"),
        target("postgres", "postgres-exporter:9187"),
        target("sandbox", "sandbox:3000"),
        target("inngest", "inngest:8288"),
      ],
      loading: false,
      offline: false,
    });

    // Order matches the input groupings; verify names + states.
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName["Portal"]).toMatchObject({ state: "up", label: "UP" });
    expect(byName["PostgreSQL"]).toMatchObject({ state: "up" });
    expect(byName["Sandbox"]).toMatchObject({ state: "up" });
    expect(byName["Inngest"]).toMatchObject({ state: "up" });
  });

  it("renders one tile per instance when a job has multiple targets", () => {
    // Multi-sandbox future: prometheus.yml lists three sandbox targets ->
    // three tiles, each labelled with its short instance name.
    const rows = deriveServiceStatusesFromTargets({
      targets: [
        target("sandbox", "sandbox-1:3000"),
        target("sandbox", "sandbox-2:3000", "down", { lastError: "context deadline exceeded" }),
        target("sandbox", "sandbox-3:3000"),
      ],
      loading: false,
      offline: false,
    });

    expect(rows.map((r) => r.name)).toEqual([
      "Sandbox (sandbox-1)",
      "Sandbox (sandbox-2)",
      "Sandbox (sandbox-3)",
    ]);
    expect(rows[1]).toMatchObject({ state: "down", label: expect.stringContaining("DOWN") });
  });

  it("hides self-monitoring (prometheus) and shows internal exporters under their job name", () => {
    const rows = deriveServiceStatusesFromTargets({
      targets: [
        target("prometheus", "localhost:9090"),
        target("node-exporter", "node-exporter:9100"),
      ],
      loading: false,
      offline: false,
    });

    expect(rows.find((r) => r.name === "Prometheus")).toBeUndefined();
    expect(rows.find((r) => r.name === "Node Exporter")).toBeTruthy();
  });

  it("falls back to the raw job name when no presentation is registered", () => {
    // Forward-compat: adding a scrape job to prometheus.yml without touching
    // JOB_PRESENTATION still gets a tile, just with the raw job string.
    const rows = deriveServiceStatusesFromTargets({
      targets: [target("brand-new-thing", "brand-new-thing:9000")],
      loading: false,
      offline: false,
    });

    expect(rows.find((r) => r.name === "brand-new-thing")).toBeTruthy();
  });

  it("emits a single loading placeholder row instead of an empty grid", () => {
    const rows = deriveServiceStatusesFromTargets({
      targets: null,
      loading: true,
      offline: false,
    });

    expect(rows).toEqual([
      expect.objectContaining({ state: "loading", label: "..." }),
    ]);
  });

  it("emits zero rows when the monitoring stack is offline (parent component shows the banner)", () => {
    const rows = deriveServiceStatusesFromTargets({
      targets: null,
      loading: false,
      offline: true,
    });

    expect(rows).toEqual([]);
  });

  it("includes lastError on DOWN tiles, truncated to fit the label", () => {
    const longError = "x".repeat(100);
    const rows = deriveServiceStatusesFromTargets({
      targets: [target("portal", "portal:3000", "down", { lastError: longError })],
      loading: false,
      offline: false,
    });

    expect(rows[0]?.state).toBe("down");
    expect(rows[0]?.label).toContain("DOWN:");
    expect(rows[0]?.label.length).toBeLessThanOrEqual("DOWN: ".length + 40);
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
