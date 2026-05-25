import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/quality", () => ({
  updateIssueReportStatus: vi.fn(),
}));

import { IssueReportPanel } from "./IssueReportPanel";

const reports = [
  {
    id: "db-1",
    reportId: "coworker-process-1-zero-tool-call",
    type: "runtime_error",
    severity: "high",
    status: "open",
    title: "[coworker-process] zero-tool-call on phase=review",
    description: "Agent closed the review phase without tool calls.",
    routeContext: "/build",
    errorStack: null,
    source: "agentic-loop-guard",
    createdAt: "2026-05-25T21:34:43.000Z",
    reportedBy: null,
  },
  {
    id: "db-2",
    reportId: "PIR-WARM",
    type: "feedback",
    severity: "medium",
    status: "acknowledged",
    title: "Model warmup ping",
    description: "Warmup probe.",
    routeContext: null,
    errorStack: null,
    source: "warmup",
    createdAt: "2026-05-25T19:58:01.000Z",
    reportedBy: null,
  },
];

const stats = {
  byStatus: { open: 1, acknowledged: 1 },
  bySeverity: { high: 1, medium: 1 },
  bySource: { "agentic-loop-guard": 1, warmup: 1 },
  last24h: 2,
  last7d: 2,
  topRoutes: [{ route: "/build", count: 1 }],
  queueSummary: {
    actionable: 1,
    processGuard: 1,
    warmupNoise: 1,
    triaged: 1,
    resolved: 0,
    suppressed: 0,
  },
};

describe("IssueReportPanel", () => {
  it("renders an action-oriented queue instead of a flat warmup-heavy list", () => {
    const html = renderToStaticMarkup(
      <IssueReportPanel items={reports} total={2} stats={stats} />,
    );

    expect(html).toContain("Needs action");
    expect(html).toContain("Process guard");
    expect(html).toContain("Warmup noise");
    expect(html).toContain("Ask System Admin");
    expect(html).toContain("Suppress");
    expect(html).not.toContain("Acknowledge");
  });
});
