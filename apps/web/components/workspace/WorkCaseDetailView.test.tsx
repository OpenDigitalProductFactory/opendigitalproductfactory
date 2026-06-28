import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkCaseDetailView } from "./WorkCaseDetailView";
import type { WorkspaceWorkCaseDetailView } from "@/lib/work-management/workspace-case-loader";

const detail: WorkspaceWorkCaseDetailView = {
  summary: {
    caseId: "booking:BK-1",
    href: "/workspace/cases/booking%3ABK-1",
    title: "Confirm condenser appointment",
    sourceLabel: "Storefront booking",
    state: "waiting-on-person",
    stateReason: "Work item is waiting on human input.",
    a2aStatus: "input-required",
    terminal: false,
    nextAction: "Collect required input",
    urgency: "urgent",
    urgencyLabel: "Urgent",
    effortLabel: "Short",
    dueAt: "2026-06-29T15:00:00.000Z",
    assignmentLabel: "Assigned to you",
    attentionRequired: true,
    attentionReason: "Work item is waiting on human input.",
    description: "Customer needs a scheduling confirmation.",
    sourceRefs: [
      { kind: "source", id: "BK-1", sourceType: "booking" },
      { kind: "work-item", id: "WI-1", status: "awaiting-input" },
    ],
  },
  evidenceTimeline: [
    {
      eventId: "evidence:EV-1",
      label: "Customer called twice.",
      sourceRef: { kind: "evidence", id: "EV-1", status: "operator-note" },
    },
  ],
  sourceRefs: [
    { kind: "source", id: "BK-1", sourceType: "booking" },
    { kind: "work-item", id: "WI-1", status: "awaiting-input" },
  ],
};

describe("WorkCaseDetailView", () => {
  it("leads with evidence before implementation source references", () => {
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={detail} />);

    expect(html).toContain("Confirm condenser appointment");
    expect(html.indexOf("Evidence timeline")).toBeLessThan(html.indexOf("Source refs"));
    expect(html).toContain("Customer called twice.");
  });

  it("keeps navigation in the Workspace section", () => {
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={detail} />);

    expect(html).toContain('href="/workspace/my-queue"');
    expect(html).not.toContain("/ops");
  });

  it("uses DPF theme tokens", () => {
    const html = renderToStaticMarkup(<WorkCaseDetailView detail={detail} />);

    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/bg-white|text-blue-|text-red-|text-orange-|text-yellow-|bg-red-|bg-orange-|bg-yellow-|#[0-9a-fA-F]{3,6}/);
  });
});
