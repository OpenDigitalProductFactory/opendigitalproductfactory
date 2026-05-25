import { describe, expect, it } from "vitest";
import {
  classifyIssueReport,
  normalizeIssueReportStatus,
  summarizeIssueReportQueue,
} from "./issue-report-queue";

const baseReport = {
  reportId: "PIR-1",
  title: "Something broke",
  status: "open",
  severity: "medium",
  source: "ai_assisted",
  routeContext: null,
};

describe("issue-report queue helpers", () => {
  it("treats legacy acknowledged reports as triaged but not active", () => {
    expect(normalizeIssueReportStatus("acknowledged")).toEqual(
      expect.objectContaining({
        canonical: "triaged_local",
        label: "Triaged",
        bucket: "triaged",
        isActive: false,
        isLegacy: true,
      }),
    );
  });

  it("classifies warmup reports as suppressible operational noise", () => {
    const classification = classifyIssueReport({
      ...baseReport,
      reportId: "PIR-WARM",
      title: "Model warmup ping",
      source: "warmup",
    });

    expect(classification.category).toBe("warmup_noise");
    expect(classification.isActionable).toBe(false);
    expect(classification.recommendedStatus).toBe("suppressed");
  });

  it("keeps open agentic-loop reports in the action queue", () => {
    const classification = classifyIssueReport({
      ...baseReport,
      reportId: "coworker-process-1-zero-tool-call",
      title: "[coworker-process] zero-tool-call on phase=review",
      severity: "high",
      source: "agentic-loop-guard",
      routeContext: "/build",
    });

    expect(classification.category).toBe("process_guard");
    expect(classification.isActionable).toBe(true);
    expect(classification.recommendedStatus).toBe("triaged_local");
  });

  it("summarizes action, process, and warmup counts for the admin queue", () => {
    const summary = summarizeIssueReportQueue([
      {
        ...baseReport,
        reportId: "coworker-process-1-zero-tool-call",
        title: "[coworker-process] zero-tool-call on phase=review",
        source: "agentic-loop-guard",
        severity: "high",
        routeContext: "/build",
      },
      {
        ...baseReport,
        reportId: "PIR-WARM",
        title: "System warmup check",
        source: "ai_assisted",
        status: "acknowledged",
      },
      {
        ...baseReport,
        reportId: "PIR-RES",
        title: "Resolved issue",
        status: "resolved_locally",
      },
    ]);

    expect(summary.actionable).toBe(1);
    expect(summary.processGuard).toBe(1);
    expect(summary.warmupNoise).toBe(1);
    expect(summary.resolved).toBe(1);
  });
});
