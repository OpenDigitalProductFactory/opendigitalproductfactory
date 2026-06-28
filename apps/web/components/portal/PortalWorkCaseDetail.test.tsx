import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PortalWorkCaseDetail } from "./PortalWorkCaseDetail";
import type { PortalWorkCaseDetailView } from "@/lib/work-management/portal-case-loader";

const fixture: PortalWorkCaseDetailView = {
  generatedAt: "2026-06-28T12:00:00.000Z",
  case: {
    caseId: "booking:BK-1",
    href: "/portal/cases/booking%3ABK-1",
    title: "Confirm condenser appointment",
    sourceLabel: "Storefront booking",
    statusLabel: "Needs your response",
    nextActionLabel: "Reply requested",
    description: "Customer needs a scheduling confirmation.",
    dueAt: "2026-06-29T15:00:00.000Z",
    createdAt: "2026-06-28T10:00:00.000Z",
    attentionRequired: true,
    supportHref: "/portal/support",
  },
  timeline: [
    {
      label: "Received",
      body: "We received this request.",
      at: "2026-06-28T10:00:00.000Z",
    },
    {
      label: "Current status",
      body: "Needs your response",
    },
    {
      label: "Due",
      body: "Target date for the next update.",
      at: "2026-06-29T15:00:00.000Z",
    },
  ],
};

describe("PortalWorkCaseDetail", () => {
  it("renders a customer-safe digest and next step", () => {
    const html = renderToStaticMarkup(<PortalWorkCaseDetail view={fixture} />);

    expect(html).toContain("Confirm condenser appointment");
    expect(html).toContain("Needs your response");
    expect(html).toContain("Reply requested");
    expect(html).toContain("Received");
    expect(html).toContain("Current status");
    expect(html).toContain('href="/portal/cases"');
    expect(html).toContain('href="/portal/support"');
  });

  it("does not expose internal source or WorkItem references", () => {
    const html = renderToStaticMarkup(<PortalWorkCaseDetail view={fixture} />);

    expect(html).not.toContain("WI-");
    expect(html).not.toContain("sourceRefs");
    expect(html).not.toContain("work-item");
    expect(html).not.toContain("sourceId");
  });

  it("uses DPF theme tokens and avoids hardcoded status colors", () => {
    const html = renderToStaticMarkup(<PortalWorkCaseDetail view={fixture} />);

    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(
      /bg-white|text-blue-|text-red-|text-orange-|text-yellow-|bg-red-|bg-orange-|bg-yellow-|#[0-9a-fA-F]{3,6}/,
    );
  });
});
