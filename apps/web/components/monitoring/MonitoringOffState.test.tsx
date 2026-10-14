// BI-2CE9CBF4 (AC-MON-07): monitoring switched off reads as a choice, never as
// healthy or broken.
import { renderToStaticMarkup } from "react-dom/server";
import { namespaceMessages } from "@dpf/i18n";
import { describe, expect, it, vi } from "vitest";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";

const status = vi.hoisted(() => ({ value: { checked: true, online: false, off: true } }));
const alertState = vi.hoisted(() => ({
  value: { alerts: [] as Array<Record<string, unknown>>, loading: false, offline: false, notConfigured: false, monitoringOff: true },
}));

vi.mock("./MonitoringContext", () => ({
  MonitoringProvider: ({ children }: { children: React.ReactNode }) => children,
  useMonitoringStatus: () => status.value,
}));
vi.mock("./useMetricQuery", () => ({ useMetricQuery: () => ({ data: null, loading: false }) }));
vi.mock("./useAlertQuery", () => ({ useAlertQuery: () => alertState.value }));
vi.mock("./LogIssuesPanel", () => ({ LogIssuesPanel: () => <div data-testid="log-issues" /> }));

import { deriveMonitoringSummary, derivePlatformSummary } from "./health-summary";
import { PlatformHealthIndicator } from "./PlatformHealthIndicator";
import { ServiceHealthDashboard } from "./ServiceHealthDashboard";
import { SystemHealthDashboard } from "./SystemHealthDashboard";

const OFF_LABEL = "Monitoring is off on this install";

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<MessagesProvider locale="en-US" messages={{ shell: namespaceMessages("en-US", "shell") }}>{node}</MessagesProvider>);

describe("monitoring switched off", () => {
  it("service health shows the off notice instead of 'unavailable'", () => {
    const html = render(<ServiceHealthDashboard openBacklogItems={0} backlogHref="/backlog" capabilityHealth={null} />);
    expect(html).toContain(OFF_LABEL);
    expect(html).not.toContain("currently unavailable");
  });

  it("system health shows the off notice, keeps log issues, and offers no Grafana link", () => {
    const html = render(<SystemHealthDashboard />);
    expect(html).toContain(OFF_LABEL);
    expect(html).toContain("log-issues");
    expect(html).not.toContain("localhost:3002");
  });

  it("the header indicator never claims all systems healthy", () => {
    const html = render(<PlatformHealthIndicator />);
    expect(html).toContain(OFF_LABEL);
    expect(html).not.toContain("All systems healthy");
  });

  it("summaries report off as neutral, not critical", () => {
    expect(deriveMonitoringSummary({ checked: true, online: false, off: true, upTargets: null, alerts: [] }))
      .toMatchObject({ tone: "neutral", detail: OFF_LABEL });
    expect(derivePlatformSummary({ checked: true, online: false, off: true, alerts: [], capabilityHealth: undefined as never }))
      .toMatchObject({ tone: "neutral" });
  });
});
