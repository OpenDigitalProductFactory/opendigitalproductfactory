import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PortalWorkCases } from "./PortalWorkCases";
import type { PortalWorkCaseListView } from "@/lib/work-management/portal-case-loader";

const fixture: PortalWorkCaseListView = {
  generatedAt: "2026-06-28T12:00:00.000Z",
  stats: {
    total: 2,
    needsResponse: 1,
    inProgress: 1,
    resolved: 0,
  },
  cases: [
    {
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
    {
      caseId: "activity:ACT-1",
      href: "/portal/cases/activity%3AACT-1",
      title: "Service follow-up",
      sourceLabel: "Activity",
      statusLabel: "In progress",
      nextActionLabel: "We are working on it",
      description: null,
      dueAt: null,
      createdAt: "2026-06-28T11:00:00.000Z",
      attentionRequired: false,
      supportHref: "/portal/support",
    },
  ],
};

describe("PortalWorkCases", () => {
  it("renders a constrained customer-facing case list", () => {
    const html = renderToStaticMarkup(<PortalWorkCases view={fixture} />);

    expect(html).toContain("Cases");
    expect(html).toContain("Confirm condenser appointment");
    expect(html).toContain("Needs your response");
    expect(html).toContain('href="/portal/cases/booking%3ABK-1"');
    expect(html).toContain('href="/portal/support"');
    expect(html).not.toContain("sourceRefs");
    expect(html).not.toContain("work-item");
    expect(html).not.toContain("Work Room");
    expect(html).not.toContain("Participants");
    expect(html).not.toContain("A2A status");
  });

  it("uses DPF theme tokens and avoids hardcoded status colors", () => {
    const html = renderToStaticMarkup(<PortalWorkCases view={fixture} />);

    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/bg-white|text-blue-|text-red-|text-orange-|text-yellow-|bg-red-|bg-orange-|bg-yellow-|#[0-9a-fA-F]{3,6}/);
  });

  it("renders a quiet empty state", () => {
    const html = renderToStaticMarkup(
      <PortalWorkCases view={{ ...fixture, stats: { total: 0, needsResponse: 0, inProgress: 0, resolved: 0 }, cases: [] }} />,
    );

    expect(html).toContain("No open cases");
    expect(html).toContain("New requests and service updates will appear here.");
  });
});
