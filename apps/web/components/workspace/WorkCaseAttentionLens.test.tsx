import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkCaseAttentionLens } from "./WorkCaseAttentionLens";
import type { WorkspaceWorkCaseLensView } from "@/lib/work-management/workspace-case-loader";

const fixture: WorkspaceWorkCaseLensView = {
  generatedAt: "2026-06-28T12:00:00.000Z",
  stats: {
    total: 2,
    needsAttention: 1,
    active: 1,
    unassigned: 1,
    dueSoon: 1,
  },
  cases: [
    {
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
    {
      caseId: "manual-task:WI-2",
      href: "/workspace/cases/manual-task%3AWI-2",
      title: "Routine filing",
      sourceLabel: "Manual task",
      state: "intake",
      stateReason: "Work item is queued for intake.",
      a2aStatus: "submitted",
      terminal: false,
      nextAction: "Triage case",
      urgency: "routine",
      urgencyLabel: "Routine",
      effortLabel: "Medium",
      dueAt: null,
      assignmentLabel: "Unassigned",
      attentionRequired: false,
      attentionReason: null,
      description: "Organize the month-end packet.",
      sourceRefs: [{ kind: "work-item", id: "WI-2", status: "queued" }],
    },
  ],
};

describe("WorkCaseAttentionLens", () => {
  it("renders attention rooms before the full queue and preserves the case detail URL", () => {
    const html = renderToStaticMarkup(<WorkCaseAttentionLens view={fixture} />);

    expect(html).toContain("My Work");
    expect(html.indexOf("Needs attention")).toBeLessThan(html.indexOf("All active rooms"));
    expect(html).toContain("Confirm condenser appointment");
    expect(html).toContain('href="/workspace/cases/booking%3ABK-1"');
    expect(html).toContain("Open room");
  });

  it("renders a mobile-first today strip for urgent attention cases", () => {
    const html = renderToStaticMarkup(<WorkCaseAttentionLens view={fixture} />);

    expect(html).toContain('aria-label="Mobile attention"');
    expect(html).toContain("Today");
    expect(html).toContain("Confirm condenser appointment");
    expect(html).toContain("Collect required input");
    expect(html).toContain('href="/workspace/cases/booking%3ABK-1"');
  });

  it("uses theme tokens and report-kit status styling instead of hardcoded status colors", () => {
    const html = renderToStaticMarkup(<WorkCaseAttentionLens view={fixture} />);

    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/bg-white|text-blue-|text-red-|text-orange-|text-yellow-|bg-red-|bg-orange-|bg-yellow-|#[0-9a-fA-F]{3,6}/);
  });

  it("renders an operator-grade empty state", () => {
    const html = renderToStaticMarkup(
      <WorkCaseAttentionLens view={{ ...fixture, cases: [], stats: { total: 0, needsAttention: 0, active: 0, unassigned: 0, dueSoon: 0 } }} />,
    );

    expect(html).toContain("No active Work Rooms");
    expect(html).toContain("New rooms will appear here when work is assigned or made available for claiming.");
  });
});
