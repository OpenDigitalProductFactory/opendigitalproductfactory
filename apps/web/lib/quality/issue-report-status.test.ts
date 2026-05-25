import { describe, expect, it } from "vitest";
import {
  ISSUE_REPORT_STATUS,
  SUPPORT_FLOW_STATUSES,
  isSupportFlowStatus,
  type IssueReportStatus,
} from "./issue-report-status";

describe("ISSUE_REPORT_STATUS", () => {
  it("defines all 9 statuses from spec §6.2", () => {
    expect(ISSUE_REPORT_STATUS).toEqual({
      OPEN: "open",
      SUPPORT_TRIAGE: "support_triage",
      RESOLVED_LOCALLY: "resolved_locally",
      TRIAGED_LOCAL: "triaged_local",
      AWAITING_ESCALATION_ACK: "awaiting_escalation_ack",
      UPSTREAM_PENDING: "upstream_pending",
      UPSTREAM_FILED: "upstream_filed",
      RESOLVED_UPSTREAM: "resolved_upstream",
      SUPPRESSED: "suppressed",
    });
  });

  it("SUPPORT_FLOW_STATUSES contains the 4 statuses the cron must skip", () => {
    expect(SUPPORT_FLOW_STATUSES).toEqual([
      "support_triage",
      "awaiting_escalation_ack",
      "upstream_pending",
      "upstream_filed",
    ]);
  });

  it("isSupportFlowStatus returns true for support-flow statuses", () => {
    expect(isSupportFlowStatus("support_triage")).toBe(true);
    expect(isSupportFlowStatus("upstream_filed")).toBe(true);
  });

  it("isSupportFlowStatus returns false for open and terminal statuses", () => {
    expect(isSupportFlowStatus("open")).toBe(false);
    expect(isSupportFlowStatus("resolved_locally")).toBe(false);
    expect(isSupportFlowStatus("triaged_local")).toBe(false);
    expect(isSupportFlowStatus("resolved_upstream")).toBe(false);
    expect(isSupportFlowStatus("suppressed")).toBe(false);
  });

  it("IssueReportStatus union type compiles for every value", () => {
    const statuses: IssueReportStatus[] = [
      "open",
      "support_triage",
      "resolved_locally",
      "triaged_local",
      "awaiting_escalation_ack",
      "upstream_pending",
      "upstream_filed",
      "resolved_upstream",
      "suppressed",
    ];
    expect(statuses).toHaveLength(9);
  });
});
