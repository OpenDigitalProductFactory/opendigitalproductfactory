import { describe, expect, it } from "vitest";

import type { WorkspaceWorkCaseListItem } from "./workspace-case-loader";
import { buildCustomerDomainWorkCaseAdoption } from "./customer-domain-adoption";

function caseItem(
  overrides: Partial<WorkspaceWorkCaseListItem> & {
    caseId: string;
    sourceType: string;
    sourceId: string;
  },
): WorkspaceWorkCaseListItem {
  return {
    caseId: overrides.caseId,
    href: `/workspace/cases/${encodeURIComponent(`${overrides.sourceType}:${overrides.sourceId}`)}`,
    title: overrides.title ?? "Customer case",
    sourceLabel: overrides.sourceLabel ?? overrides.sourceType,
    state: overrides.state ?? "active",
    stateReason: overrides.stateReason ?? "Work is active.",
    a2aStatus: overrides.a2aStatus ?? "working",
    terminal: overrides.terminal ?? false,
    nextAction: overrides.nextAction ?? "Continue work",
    urgency: overrides.urgency ?? "routine",
    urgencyLabel: overrides.urgencyLabel ?? "Routine",
    effortLabel: overrides.effortLabel ?? "Medium",
    dueAt: overrides.dueAt ?? null,
    assignmentLabel: overrides.assignmentLabel ?? "Assigned",
    attentionRequired: overrides.attentionRequired ?? false,
    attentionReason: overrides.attentionReason ?? null,
    description: overrides.description ?? null,
    sourceRefs: overrides.sourceRefs ?? [
      { kind: "source", id: overrides.sourceId, sourceType: overrides.sourceType },
    ],
  };
}

describe("customer-domain Work Case adoption", () => {
  it("groups customer service and revenue cases into WWWD workflow lanes", () => {
    const view = buildCustomerDomainWorkCaseAdoption([
      caseItem({
        caseId: "booking:BK-1",
        sourceType: "booking",
        sourceId: "BK-1",
        title: "Confirm appointment",
        attentionRequired: true,
      }),
      caseItem({
        caseId: "opportunity:OPP-1",
        sourceType: "opportunity",
        sourceId: "OPP-1",
        title: "Renewal proposal",
      }),
    ]);

    expect(view.lanes.map((lane) => lane.laneId)).toEqual([
      "customer-service",
      "revenue-work",
    ]);
    expect(view.lanes.every((lane) => lane.decisionScope === "wwwd")).toBe(true);
    expect(view.lanes[0]).toMatchObject({
      label: "Customer service",
      caseCount: 1,
      attentionCount: 1,
    });
    expect(view.lanes[1].cases[0]).toMatchObject({
      caseId: "opportunity:OPP-1",
      sourceLabel: "opportunity",
    });
  });

  it("excludes platform-development cases from the customer workflow view", () => {
    const view = buildCustomerDomainWorkCaseAdoption([
      caseItem({
        caseId: "backlog-item:BI-1",
        sourceType: "backlog-item",
        sourceId: "BI-1",
        sourceLabel: "Backlog item",
      }),
      caseItem({
        caseId: "activity:ACT-1",
        sourceType: "activity",
        sourceId: "ACT-1",
        sourceLabel: "Activity",
      }),
    ]);

    expect(view.totalCases).toBe(1);
    expect(view.lanes).toHaveLength(1);
    expect(view.lanes[0]).toMatchObject({
      laneId: "customer-service",
      caseCount: 1,
    });
  });
});
