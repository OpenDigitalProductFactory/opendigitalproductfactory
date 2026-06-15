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

/**
 * Plain-language explanation of an issue report for a NON-TECHNICAL operator
 * (BI-E42C0B7E). The raw title / stack trace are written for engineers; this
 * turns each report into "what this means" + "what you can do" so a founder can
 * act without reading a stack trace.
 *
 * High-signal patterns (tool-capability / provider outage / zero-tool-call) are
 * matched first because those are the reports operators hit most and the ones
 * the raw text explains worst.
 */
export type IssueReportExplanation = {
  meaning: string;
  whatToDo: string;
};

export function explainIssueReport(
  report: IssueReportQueueInput & { description?: string | null },
): IssueReportExplanation {
  const category = detectCategory(report);
  const haystack = `${report.title} ${report.description ?? ""}`.toLowerCase();

  const mentionsTool = /tool/.test(haystack);
  const isZeroToolCall = /zero-tool-call|no tool call|without (?:calling|using) (?:a |any )?tool/.test(haystack);
  const isToolCapability =
    /tool-use-capable|supports tools|exceeds threshold|skipped local fallback|tool-capable/.test(haystack);
  const isProviderOutage =
    /rate.?limit|overload|provider (?:unavailable|temporarily|status)|all endpoints failed|\b429\b|\b529\b/.test(
      haystack,
    );

  if (isZeroToolCall || (category === "process_guard" && mentionsTool)) {
    return {
      meaning:
        "A coworker was expected to use its tools to do real work but finished a turn without calling any. " +
        "This usually means it was running on the small bundled local model — because your paid AI providers were " +
        "briefly unavailable — and that model can't reliably drive a large set of tools.",
      whatToDo:
        "This normally clears itself once your paid AI providers (Claude / GPT) are available again. " +
        "If it keeps happening, open Platform > AI > Providers & Routing and confirm a paid, tool-capable provider is active.",
    };
  }

  if (isToolCapability || isProviderOutage) {
    return {
      meaning:
        "The platform briefly had no powerful, tool-capable AI provider available — usually because your paid " +
        "providers (Claude / GPT) were rate-limited for a short period, leaving only the small bundled local model.",
      whatToDo:
        "No setup change is usually needed; this clears on its own within a minute or two. " +
        "If it persists, open Platform > AI > Providers & Routing to confirm a paid provider is connected and active.",
    };
  }

  switch (category) {
    case "warmup_noise":
      return {
        meaning: "A routine internal health check, not a real problem.",
        whatToDo: "Safe to suppress — it's background noise from the platform checking itself.",
      };
    case "runtime":
      return {
        meaning:
          "The app hit an unexpected error while a page or action was running. The technical detail below is for " +
          "engineers; the key fact is that a screen or action failed.",
        whatToDo:
          'If you can reproduce it, note what you clicked. Use "Ask System Admin" to investigate, or ' +
          '"Send to Build Studio as a fix" to queue a repair.',
      };
    case "user_feedback":
      return {
        meaning: "Feedback or a problem reported by a person using the platform.",
        whatToDo: "Review the description and decide whether it needs a fix or a follow-up.",
      };
    case "process_guard":
      return {
        meaning:
          "An automated guard noticed a coworker's work session behaved abnormally (for example, stalling or looping).",
        whatToDo: 'Use "Ask System Admin" to investigate the cause, then triage.',
      };
    default:
      return {
        meaning: "An issue the platform recorded for review.",
        whatToDo: 'Use "Ask System Admin" to investigate, then triage or resolve.',
      };
  }
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
