/**
 * PlatformIssueReport status vocabulary.
 *
 * Defined in spec §6.2 of
 * docs/superpowers/specs/2026-05-24-capacity-aware-feedback-escalation-design.md.
 *
 * Only OPEN is actively used in Phase 0. Later phases will activate the
 * SUPPORT_TRIAGE / *_ESCALATION* / UPSTREAM_* / RESOLVED_* / SUPPRESSED
 * statuses. Constants are defined now so no writer invents strings later.
 */
export const ISSUE_REPORT_STATUS = {
  OPEN: "open",
  SUPPORT_TRIAGE: "support_triage",
  RESOLVED_LOCALLY: "resolved_locally",
  TRIAGED_LOCAL: "triaged_local",
  AWAITING_ESCALATION_ACK: "awaiting_escalation_ack",
  UPSTREAM_PENDING: "upstream_pending",
  UPSTREAM_FILED: "upstream_filed",
  RESOLVED_UPSTREAM: "resolved_upstream",
  SUPPRESSED: "suppressed",
} as const;

export type IssueReportStatus =
  (typeof ISSUE_REPORT_STATUS)[keyof typeof ISSUE_REPORT_STATUS];

/**
 * Statuses owned by the support flow. The generic issue-report-triage cron
 * must skip these — they are managed by coworker support mode, not by the
 * auto-BI conversion path.
 */
export const SUPPORT_FLOW_STATUSES: ReadonlyArray<IssueReportStatus> = [
  ISSUE_REPORT_STATUS.SUPPORT_TRIAGE,
  ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK,
  ISSUE_REPORT_STATUS.UPSTREAM_PENDING,
  ISSUE_REPORT_STATUS.UPSTREAM_FILED,
];

export function isSupportFlowStatus(status: string): boolean {
  return (SUPPORT_FLOW_STATUSES as ReadonlyArray<string>).includes(status);
}
