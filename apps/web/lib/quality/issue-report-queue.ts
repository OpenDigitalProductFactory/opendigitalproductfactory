import { ISSUE_REPORT_STATUS, type IssueReportStatus } from "./issue-report-status";

export const LEGACY_ISSUE_REPORT_STATUS = {
  ACKNOWLEDGED: "acknowledged",
  RESOLVED: "resolved",
} as const;

export type LegacyIssueReportStatus =
  (typeof LEGACY_ISSUE_REPORT_STATUS)[keyof typeof LEGACY_ISSUE_REPORT_STATUS];

export type IssueReportStatusBucket =
  | "needs_action"
  | "support_flow"
  | "triaged"
  | "resolved"
  | "suppressed"
  | "unknown";

export type IssueReportCategory =
  | "process_guard"
  | "warmup_noise"
  | "user_feedback"
  | "runtime"
  | "other";

export type IssueReportQueueInput = {
  reportId: string;
  type?: string;
  title: string;
  status: string;
  severity: string;
  source: string;
  routeContext: string | null;
};

export type NormalizedIssueReportStatus = {
  raw: string;
  canonical: IssueReportStatus | string;
  label: string;
  bucket: IssueReportStatusBucket;
  isActive: boolean;
  isTerminal: boolean;
  isLegacy: boolean;
};

export type IssueReportClassification = {
  category: IssueReportCategory;
  categoryLabel: string;
  actionLabel: string;
  recommendedStatus: IssueReportStatus;
  status: NormalizedIssueReportStatus;
  isActionable: boolean;
};

export type IssueReportQueueSummary = {
  actionable: number;
  processGuard: number;
  warmupNoise: number;
  triaged: number;
  resolved: number;
  suppressed: number;
};

export function normalizeIssueReportStatus(status: string): NormalizedIssueReportStatus {
  switch (status) {
    case ISSUE_REPORT_STATUS.OPEN:
      return normalized(status, ISSUE_REPORT_STATUS.OPEN, "Open", "needs_action", true, false);
    case ISSUE_REPORT_STATUS.SUPPORT_TRIAGE:
      return normalized(status, ISSUE_REPORT_STATUS.SUPPORT_TRIAGE, "Support triage", "support_flow", true, false);
    case ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK:
      return normalized(status, ISSUE_REPORT_STATUS.AWAITING_ESCALATION_ACK, "Awaiting escalation", "support_flow", true, false);
    case ISSUE_REPORT_STATUS.UPSTREAM_PENDING:
      return normalized(status, ISSUE_REPORT_STATUS.UPSTREAM_PENDING, "Upstream pending", "support_flow", true, false);
    case ISSUE_REPORT_STATUS.UPSTREAM_FILED:
      return normalized(status, ISSUE_REPORT_STATUS.UPSTREAM_FILED, "Upstream filed", "support_flow", true, false);
    case ISSUE_REPORT_STATUS.TRIAGED_LOCAL:
      return normalized(status, ISSUE_REPORT_STATUS.TRIAGED_LOCAL, "Triaged", "triaged", false, false);
    case LEGACY_ISSUE_REPORT_STATUS.ACKNOWLEDGED:
      return normalized(status, ISSUE_REPORT_STATUS.TRIAGED_LOCAL, "Triaged", "triaged", false, false, true);
    case ISSUE_REPORT_STATUS.RESOLVED_LOCALLY:
      return normalized(status, ISSUE_REPORT_STATUS.RESOLVED_LOCALLY, "Resolved locally", "resolved", false, true);
    case ISSUE_REPORT_STATUS.RESOLVED_UPSTREAM:
      return normalized(status, ISSUE_REPORT_STATUS.RESOLVED_UPSTREAM, "Resolved upstream", "resolved", false, true);
    case LEGACY_ISSUE_REPORT_STATUS.RESOLVED:
      return normalized(status, ISSUE_REPORT_STATUS.RESOLVED_LOCALLY, "Resolved", "resolved", false, true, true);
    case ISSUE_REPORT_STATUS.SUPPRESSED:
      return normalized(status, ISSUE_REPORT_STATUS.SUPPRESSED, "Suppressed", "suppressed", false, true);
    default:
      return normalized(status, status, humanizeStatus(status), "unknown", status === ISSUE_REPORT_STATUS.OPEN, false);
  }
}

export function classifyIssueReport(report: IssueReportQueueInput): IssueReportClassification {
  const status = normalizeIssueReportStatus(report.status);
  const category = detectCategory(report);
  const recommendedStatus =
    category === "warmup_noise" ? ISSUE_REPORT_STATUS.SUPPRESSED : ISSUE_REPORT_STATUS.TRIAGED_LOCAL;

  return {
    category,
    categoryLabel: categoryLabel(category),
    actionLabel: actionLabel(category),
    recommendedStatus,
    status,
    isActionable: status.isActive && category !== "warmup_noise",
  };
}

export function summarizeIssueReportQueue(reports: IssueReportQueueInput[]): IssueReportQueueSummary {
  return reports.reduce<IssueReportQueueSummary>((summary, report) => {
    const classification = classifyIssueReport(report);
    if (classification.isActionable) summary.actionable += 1;
    if (classification.category === "process_guard") summary.processGuard += 1;
    if (classification.category === "warmup_noise") summary.warmupNoise += 1;
    if (classification.status.bucket === "triaged") summary.triaged += 1;
    if (classification.status.bucket === "resolved") summary.resolved += 1;
    if (classification.status.bucket === "suppressed") summary.suppressed += 1;
    return summary;
  }, {
    actionable: 0,
    processGuard: 0,
    warmupNoise: 0,
    triaged: 0,
    resolved: 0,
    suppressed: 0,
  });
}

function normalized(
  raw: string,
  canonical: IssueReportStatus | string,
  label: string,
  bucket: IssueReportStatusBucket,
  isActive: boolean,
  isTerminal: boolean,
  isLegacy = false,
): NormalizedIssueReportStatus {
  return { raw, canonical, label, bucket, isActive, isTerminal, isLegacy };
}

function detectCategory(report: IssueReportQueueInput): IssueReportCategory {
  const title = report.title.toLowerCase();
  const source = report.source.toLowerCase();
  const reportId = report.reportId.toLowerCase();

  if (
    source === "warmup" ||
    title.includes("model warmup ping") ||
    title.includes("system warmup check")
  ) {
    return "warmup_noise";
  }
  if (source === "agentic-loop-guard" || reportId.startsWith("coworker-process-")) {
    return "process_guard";
  }
  if (report.type === "user_report" || report.type === "feedback") {
    return "user_feedback";
  }
  if (report.type === "runtime_error") {
    return "runtime";
  }
  return "other";
}

function categoryLabel(category: IssueReportCategory): string {
  switch (category) {
    case "process_guard":
      return "Process guard";
    case "warmup_noise":
      return "Warmup noise";
    case "user_feedback":
      return "User feedback";
    case "runtime":
      return "Runtime";
    default:
      return "Other";
  }
}

function actionLabel(category: IssueReportCategory): string {
  switch (category) {
    case "process_guard":
      return "Investigate";
    case "warmup_noise":
      return "Suppress";
    case "user_feedback":
      return "Review";
    case "runtime":
      return "Diagnose";
    default:
      return "Review";
  }
}

function humanizeStatus(status: string): string {
  return status
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || "Unknown";
}
