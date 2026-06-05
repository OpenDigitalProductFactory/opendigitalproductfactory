import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/quality", () => ({
  updateIssueReportStatus: vi.fn(),
  sendIssueReportToBuildStudioAsFix: vi.fn(),
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
    triggerKind: null,
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
    triggerKind: null,
    createdAt: "2026-05-25T19:58:01.000Z",
    reportedBy: null,
  },
];

const coworkerRegressionReport = {
  id: "db-3",
  reportId: "PIR-COWORKER-REGRESSION",
  type: "runtime_error",
  severity: "high",
  status: "open",
  title: "Coworker latency regression: support-specialist on /platform/ai",
  description:
    "Diagnosis: slow-provider-dispatch\nRecent p95: 9000ms\nBaseline p95: 2000ms\nRatio: 4.5\nDispatches: 3\nNudges: 1\nTools attached: true\nExecuted tools: 0\nProvider: anthropic\nModel: claude-sonnet\nProbable cause: slow-provider-dispatch",
  routeContext: "/platform/ai",
  errorStack: null,
  source: "coworker-regression-detector",
  triggerKind: "latency-regression",
  createdAt: "2026-06-05T10:05:00.000Z",
  reportedBy: null,
};

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

  it("renders a structured coworker-regression diagnosis with a send-to-fix action", () => {
    const html = renderToStaticMarkup(
      <IssueReportPanel
        items={[coworkerRegressionReport]}
        total={1}
        stats={{
          ...stats,
          queueSummary: {
            actionable: 1,
            processGuard: 0,
            warmupNoise: 0,
            triaged: 0,
            resolved: 0,
            suppressed: 0,
          },
        }}
      />,
    );

    // The platform explains the regression, scannable in Admin > Issue Reports.
    expect(html).toContain("Coworker regression");
    expect(html).toContain("slow-provider-dispatch");
    expect(html).toContain("Recent p95");
    // Operator can act: send the PIR to Build Studio as a fix.
    expect(html).toContain("Send to Build Studio as a fix");
  });
});
