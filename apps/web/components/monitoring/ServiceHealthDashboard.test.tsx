import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CapabilityServiceHealthProjection } from "@/lib/platform-runtime/service-health";

vi.mock("./MonitoringContext", () => ({
  MonitoringProvider: ({ children }: { children: React.ReactNode }) => children,
  useMonitoringStatus: () => ({ checked: true, online: true }),
}));
vi.mock("./useMetricQuery", () => ({
  useMetricQuery: () => ({ data: [], loading: false }),
}));
vi.mock("./useAlertQuery", () => ({ useAlertQuery: () => ({ alerts: [] }) }));
vi.mock("./AlertBanner", () => ({ AlertBanner: () => null }));
vi.mock("./ServiceStatusGrid", () => ({ ServiceStatusGrid: () => null }));
vi.mock("./MetricGauge", () => ({ MetricGauge: () => null }));
vi.mock("./MetricTimeSeries", () => ({ MetricTimeSeries: () => null }));
vi.mock("./MetricTable", () => ({ MetricTable: () => null }));
vi.mock("./AiCoworkerHealthPanel", () => ({ AiCoworkerHealthPanel: () => null }));
vi.mock("./RecentAlertsPanel", () => ({ RecentAlertsPanel: () => null }));

import { ServiceHealthDashboard } from "./ServiceHealthDashboard";

const projection: CapabilityServiceHealthProjection = {
  aggregate: { value: "Operational", tone: "success", detail: "Required services available" },
  items: [{
    key: "speech-to-text",
    kind: "service",
    state: "optional_inactive",
    availability: "inactive",
    label: "Optional — inactive",
    action: "Enable its runtime capability when this service is needed.",
    tone: "neutral",
    healthSemantics: "http",
  }],
};

const missingRequired: CapabilityServiceHealthProjection = {
  aggregate: { value: "Degraded", tone: "warning", detail: "portal requires attention" },
  items: [{
    key: "portal",
    kind: "service",
    state: "required",
    availability: "unavailable",
    label: "Required — unavailable",
    action: "Restore the service and verify its configured health check.",
    tone: "warning",
    healthSemantics: "http",
  }],
};

describe("ServiceHealthDashboard", () => {
  it("renders the shared capability projection on the product health surface", () => {
    const html = renderToStaticMarkup(
      <ServiceHealthDashboard capabilityHealth={projection} />,
    );

    expect(html).toContain("Capability service requirements");
    expect(html).toContain("Optional — inactive");
  });

  it("propagates a missing required service into the product health summary", () => {
    const html = renderToStaticMarkup(
      <ServiceHealthDashboard
        capabilityHealth={missingRequired}
        openBacklogItems={0}
        backlogHref="/portfolio/backlog"
      />,
    );

    expect(html).toContain("Required — unavailable");
    expect(html).toContain("Degraded");
    expect(html).toContain("portal requires attention");
  });
});
