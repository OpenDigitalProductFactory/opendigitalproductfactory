import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LOCALE, namespaceMessages, translate } from "@dpf/i18n";
import type { ReactNode } from "react";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";

import type { CapabilityServiceHealthProjection } from "@/lib/platform-runtime/service-health";

vi.mock("./MonitoringContext", () => ({
  MonitoringProvider: ({ children }: { children: React.ReactNode }) => children,
  useMonitoringStatus: () => ({ checked: true, online: true }),
}));
vi.mock("./useMetricQuery", () => ({
  useMetricQuery: () => ({ data: [], loading: false }),
}));
const monitoringState = vi.hoisted(() => ({
  alerts: [] as Array<Record<string, unknown>>,
  bannerProps: [] as Array<Record<string, unknown>>,
  gridProps: [] as Array<Record<string, unknown>>,
}));
vi.mock("./useAlertQuery", () => ({ useAlertQuery: () => ({ alerts: monitoringState.alerts }) }));
vi.mock("./AlertBanner", () => ({
  AlertBanner: (props: Record<string, unknown>) => {
    monitoringState.bannerProps.push(props);
    return null;
  },
}));
vi.mock("./ServiceStatusGrid", () => ({
  ServiceStatusGrid: (props: Record<string, unknown>) => {
    monitoringState.gridProps.push(props);
    return null;
  },
}));
vi.mock("./MetricGauge", () => ({ MetricGauge: () => null }));
vi.mock("./MetricTimeSeries", () => ({ MetricTimeSeries: () => null }));
vi.mock("./MetricTable", () => ({ MetricTable: () => null }));
vi.mock("./AiCoworkerHealthPanel", () => ({ AiCoworkerHealthPanel: () => null }));
vi.mock("./RecentAlertsPanel", () => ({ RecentAlertsPanel: () => null }));

import { ServiceHealthDashboard } from "./ServiceHealthDashboard";

function renderLocalized(element: ReactNode, locale = DEFAULT_LOCALE) {
  return renderToStaticMarkup(
    <MessagesProvider locale={locale} messages={{ admin: namespaceMessages(locale, "admin") }}>{element}</MessagesProvider>,
  );
}
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
  it("uses the product page's catalog for the shared health view in a pseudo-locale", () => {
    const html = renderLocalized(<ServiceHealthDashboard capabilityHealth={projection} />, "en-XA");
    expect(html).toContain(translate("en-XA", "admin", "runtimeHealth.capabilityServices.heading"));
    expect(html).toContain(translate("en-XA", "admin", "runtimeHealth.capabilityServices.inactiveSummary", { count: 1 }));
    expect(html).toContain("speech-to-text");
  });
  it("renders the shared capability projection on the product health surface", () => {
    const html = renderLocalized(
      <ServiceHealthDashboard capabilityHealth={projection} />,
    );

    expect(html).toContain("Service requirements");
    expect(html).toContain("Optional — inactive");
  });

  it("propagates a missing required service into the product health summary", () => {
    const html = renderLocalized(
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

  // BI-36DE938C — runtime:adp-integration disabled, the static scrape target
  // adp:8600 down, and Prometheus firing ContainerDown for it.
  it("does not lead with Critical for a down target owned by a disabled capability", () => {
    monitoringState.alerts = [{
      labels: { alertname: "ContainerDown", severity: "critical", job: "adp", instance: "adp:8600" },
      annotations: { summary: "Service adp is down" },
      state: "firing",
      activeAt: "2026-10-06T10:00:00.000Z",
    }];
    monitoringState.bannerProps = [];
    monitoringState.gridProps = [];
    const adpInactive: CapabilityServiceHealthProjection = {
      ...projection,
      items: [{ ...projection.items[0]!, key: "adp" }],
    };
    try {
      const html = renderLocalized(
        <ServiceHealthDashboard
          capabilityHealth={adpInactive}
          openBacklogItems={0}
          backlogHref="/portfolio/backlog"
        />,
      );

      expect(html).not.toContain("Critical");
      expect(html).not.toContain("Service adp is down");
      expect(html).toContain("Required services available");
      const inactiveSets = [...monitoringState.bannerProps, ...monitoringState.gridProps].map(
        (props) => [...((props.inactiveServices as ReadonlySet<string> | undefined) ?? [])],
      );
      expect(inactiveSets).toEqual([["adp"], ["adp"]]);
    } finally {
      monitoringState.alerts = [];
    }
  });
});
