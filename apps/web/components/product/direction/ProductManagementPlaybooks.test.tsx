import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/agent-task-scheduler", () => ({
  rerunAgentTask: vi.fn(),
  setAgentTaskActive: vi.fn(),
}));
vi.mock("@/lib/actions/product-management-playbooks", () => ({
  scheduleProductManagementPlaybookAction: vi.fn(),
}));

import { ProductManagementPlaybooks } from "./ProductManagementPlaybooks";

const snapshot = {
  schemaVersion: 1 as const,
  importable: false as const,
  authority: "derived-snapshot" as const,
  recipeId: "stakeholder-brief" as const,
  scope: {
    kind: "product" as const,
    organizationId: "org-1",
    productLineId: "line-1",
    businessProductId: "product-1",
  },
  generatedAt: "2026-07-28T12:00:00.000Z",
  asOf: "2026-07-28T11:00:00.000Z",
  confidence: "partial" as const,
  sourceIds: ["backlog-item:BI-1"],
  sources: [],
  sections: [],
};

describe("ProductManagementPlaybooks", () => {
  it("keeps scheduling behind a preview and uses owner-operator task language", () => {
    const html = renderToStaticMarkup(
      <ProductManagementPlaybooks
        scope={{ kind: "product", id: "product-1" }}
        audience="guided"
        scheduledPlaybooks={[]}
        snapshot={snapshot}
        adoptionEvidence={[]}
      />,
    );
    expect(html).toContain("Choose a useful review");
    expect(html).toContain("Preview first run");
    expect(html).toContain("Preview required");
    expect(html).not.toContain("Confirm weekly schedule");
    expect(html).toContain("Nothing runs automatically");
  });

  it("states partial, failed, paused, and changed-permission posture in text", () => {
    const base = {
      id: "task-1",
      taskId: "task-1",
      sourceKind: "scheduled-agent-task",
      asOf: new Date("2026-07-28T12:00:00Z"),
      title: "Outcome review",
      status: "active",
      scope: "business-product" as const,
      productLineId: null,
      businessProductId: "product-1",
      schedule: "0 9 1 * *",
      isActive: true,
      nextRunAt: new Date("2026-08-01T09:00:00Z"),
      lastRunAt: new Date("2026-07-01T09:00:00Z"),
      taskRunId: "TR-PM-1",
      lastStatus: "partial",
      lastError: null,
      taskKind: "product-management-playbook",
      recipeId: "outcome-review",
      permissionsDigest: "pm-permissions-old",
      permissionsCurrent: true,
    };
    const html = renderToStaticMarkup(
      <ProductManagementPlaybooks
        scope={{ kind: "product", id: "product-1" }}
        audience="professional"
        scheduledPlaybooks={[
          base,
          {
            ...base,
            id: "task-2",
            taskId: "task-2",
            title: "Roadmap refresh",
            lastStatus: "error",
            lastError: "Evidence source failed.",
          },
          {
            ...base,
            id: "task-3",
            taskId: "task-3",
            title: "Owner brief",
            isActive: false,
            status: "paused",
          },
          {
            ...base,
            id: "task-4",
            taskId: "task-4",
            title: "Demand triage",
            permissionsCurrent: false,
          },
        ]}
        snapshot={snapshot}
        adoptionEvidence={[]}
      />,
    );
    expect(html).toContain(
      "Partial — the prior successful result remains current",
    );
    expect(html).toContain("Failed");
    expect(html).toContain("Paused");
    expect(html).toContain("Preview required");
    expect(html).toContain("Evidence source failed.");
    expect(html).toContain(
      'href="/platform/ai/history?taskRunId=TR-PM-1"',
    );
  });
});
