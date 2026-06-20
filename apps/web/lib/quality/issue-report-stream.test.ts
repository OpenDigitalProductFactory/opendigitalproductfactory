import { describe, expect, it } from "vitest";
import { classifyIssueReportStream, isResponderStream } from "./issue-report-stream";
import { ISSUE_REPORT_STATUS } from "./issue-report-status";

describe("classifyIssueReportStream", () => {
  it("classifies a self-fix escalation by selfFixClass", () => {
    expect(classifyIssueReportStream({ source: "build-studio", selfFixClass: "needs-human" }))
      .toBe("self-fix-escalation");
  });

  it("classifies a self-fix escalation by type", () => {
    expect(classifyIssueReportStream({ type: "build-stall-escalation", source: "build-studio" }))
      .toBe("self-fix-escalation");
  });

  it("keeps a guarded escalation as self-fix even when born in a support-flow status", () => {
    // The projection guard births escalations in awaiting_escalation_ack (a
    // SUPPORT_FLOW status). Self-fix must win over the support-status rule, or a
    // guarded escalation would mis-route to the support pipeline.
    expect(
      classifyIssueReportStream({
        type: "build-stall-escalation",
        status: ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK,
        selfFixClass: "needs-human",
      }),
    ).toBe("self-fix-escalation");
  });

  it("routes support-flow statuses to support vs upstream", () => {
    expect(classifyIssueReportStream({ status: ISSUE_REPORT_STATUS.SUPPORT_TRIAGE }))
      .toBe("support-feedback");
    expect(classifyIssueReportStream({ status: ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK }))
      .toBe("support-feedback");
    expect(classifyIssueReportStream({ status: ISSUE_REPORT_STATUS.UPSTREAM_PENDING }))
      .toBe("upstream-feedback");
    expect(classifyIssueReportStream({ status: ISSUE_REPORT_STATUS.UPSTREAM_FILED }))
      .toBe("upstream-feedback");
  });

  it("classifies automated noise sources as digest", () => {
    expect(classifyIssueReportStream({ source: "warmup" })).toBe("noise-digest");
    expect(classifyIssueReportStream({ source: "log-signature-scanner", severity: "low" }))
      .toBe("noise-digest");
  });

  it("classifies crashes and digest-bearing reports as runtime-fault", () => {
    expect(classifyIssueReportStream({ source: "crash_boundary" })).toBe("runtime-fault");
    expect(classifyIssueReportStream({ source: "manual", errorDigest: "abc123" }))
      .toBe("runtime-fault");
  });

  it("fails safe to runtime-fault for unknown/high-severity reports (never suppresses)", () => {
    expect(classifyIssueReportStream({ source: "manual", severity: "high" }))
      .toBe("runtime-fault");
    expect(classifyIssueReportStream({})).toBe("runtime-fault");
  });

  it("a high-severity escalation never falls through to noise", () => {
    // selfFixClass wins even if a future noise source were also set.
    expect(
      classifyIssueReportStream({ source: "warmup", selfFixClass: "needs-human", severity: "high" }),
    ).toBe("self-fix-escalation");
  });
});

describe("isResponderStream", () => {
  it("only self-fix-escalation is a responder stream", () => {
    expect(isResponderStream("self-fix-escalation")).toBe(true);
    expect(isResponderStream("runtime-fault")).toBe(false);
    expect(isResponderStream("noise-digest")).toBe(false);
    expect(isResponderStream("support-feedback")).toBe(false);
    expect(isResponderStream("upstream-feedback")).toBe(false);
  });
});
