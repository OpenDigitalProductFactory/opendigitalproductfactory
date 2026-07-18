import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("./MonitoringContext", () => ({
  useMonitoringStatus: () => ({ checked: true, online: true }),
}));

vi.mock("./useMetricQuery", () => ({
  useMetricQuery: () => ({ data: [], loading: false }),
}));

vi.mock("./useAlertQuery", () => ({
  useAlertQuery: () => ({ alerts: [] }),
}));

import { PortalHealthSummary } from "./PortalHealthSummary";

const inactiveOptional = {
  aggregate: { value: "Operational" as const, tone: "success" as const, detail: "Required services available" },
  items: [{
    key: "speech-to-text",
    kind: "service" as const,
    state: "optional_inactive" as const,
    availability: "inactive" as const,
    label: "Optional — inactive",
    action: "Enable its runtime capability when this service is needed.",
    tone: "neutral" as const,
    healthSemantics: "http",
  }],
};

const missingRequired = {
  aggregate: { value: "Degraded" as const, tone: "warning" as const, detail: "portal requires attention" },
  items: [{
    key: "portal",
    kind: "service" as const,
    state: "required" as const,
    availability: "unavailable" as const,
    label: "Required — unavailable",
    action: "Restore the service.",
    tone: "warning" as const,
    healthSemantics: "http",
  }],
};

describe("PortalHealthSummary — Open Backlog Items card (BI-FDE4A056)", () => {
  it("shows no '->' arrow and no link when there are zero open backlog items", () => {
    const html = renderToStaticMarkup(
      <PortalHealthSummary capabilityHealth={inactiveOptional} openBacklogItems={0} backlogHref="/portfolio/backlog" />,
    );
    expect(html).toContain("No open backlog items");
    // The misleading affordance must be gone: no arrow, no link to the backlog.
    // renderToStaticMarkup HTML-escapes ">" so the arrow is "-&gt;".
    expect(html).not.toContain("-&gt;");
    expect(html).not.toContain('href="/portfolio/backlog"');
  });

  it("links to the backlog and shows the '->' affordance when items exist", () => {
    const html = renderToStaticMarkup(
      <PortalHealthSummary capabilityHealth={inactiveOptional} openBacklogItems={5} backlogHref="/portfolio/backlog" />,
    );
    expect(html).toContain("View list");
    expect(html).toContain("-&gt;");
    expect(html).toContain('href="/portfolio/backlog"');
  });

  it("keeps the platform operational when only an optional service is inactive", () => {
    const html = renderToStaticMarkup(
      <PortalHealthSummary capabilityHealth={inactiveOptional} openBacklogItems={0} backlogHref="/portfolio/backlog" />,
    );
    expect(html).toContain("Operational");
    expect(html).toContain("Required services available");
  });

  it("degrades the platform when a required service is unavailable", () => {
    const html = renderToStaticMarkup(
      <PortalHealthSummary capabilityHealth={missingRequired} openBacklogItems={0} backlogHref="/portfolio/backlog" />,
    );
    expect(html).toContain("Degraded");
    expect(html).toContain("portal requires attention");
  });
});
