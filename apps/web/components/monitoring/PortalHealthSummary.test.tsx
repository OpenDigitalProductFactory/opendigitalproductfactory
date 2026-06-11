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

describe("PortalHealthSummary — Open Backlog Items card (BI-FDE4A056)", () => {
  it("shows no '->' arrow and no link when there are zero open backlog items", () => {
    const html = renderToStaticMarkup(
      <PortalHealthSummary openBacklogItems={0} backlogHref="/portfolio/backlog" />,
    );
    expect(html).toContain("No open backlog items");
    // The misleading affordance must be gone: no arrow, no link to the backlog.
    // renderToStaticMarkup HTML-escapes ">" so the arrow is "-&gt;".
    expect(html).not.toContain("-&gt;");
    expect(html).not.toContain('href="/portfolio/backlog"');
  });

  it("links to the backlog and shows the '->' affordance when items exist", () => {
    const html = renderToStaticMarkup(
      <PortalHealthSummary openBacklogItems={5} backlogHref="/portfolio/backlog" />,
    );
    expect(html).toContain("View list");
    expect(html).toContain("-&gt;");
    expect(html).toContain('href="/portfolio/backlog"');
  });
});
