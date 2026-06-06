"use client";

import { useMemo, useState, useTransition } from "react";
import { Archive, Bot, CheckCircle2, Filter, ShieldAlert, Wrench } from "lucide-react";
import { updateIssueReportStatus, sendIssueReportToBuildStudioAsFix } from "@/lib/actions/quality";
import { StatCard, StatusBadge } from "@/components/ui/report-kit";
import { ISSUE_REPORT_STATUS, type IssueReportStatus } from "@/lib/quality/issue-report-status";
import {
  classifyIssueReport,
  explainIssueReport,
  normalizeIssueReportStatus,
  summarizeIssueReportQueue,
  type IssueReportCategory,
  type IssueReportQueueSummary,
} from "@/lib/quality/issue-report-queue";

interface ReportRow {
  id: string;
  reportId: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  routeContext: string | null;
  errorStack: string | null;
  source: string;
  triggerKind: string | null;
  createdAt: string;
  reportedBy: { id: string; name: string | null; email: string | null } | null;
}

interface Stats {
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  bySource?: Record<string, number>;
  last24h: number;
  last7d: number;
  topRoutes: Array<{ route: string | null; count: number }>;
  queueSummary?: IssueReportQueueSummary;
}

type QueueFilter = "needs_action" | "process_guard" | "warmup_noise" | "all";

const FILTERS: Array<{ id: QueueFilter; label: string }> = [
  { id: "needs_action", label: "Needs action" },
  { id: "process_guard", label: "Process guard" },
  { id: "warmup_noise", label: "Warmup noise" },
  { id: "all", label: "All reports" },
];

export function IssueReportPanel({
  items: initialItems,
  total,
  stats,
}: {
  items: ReportRow[];
  total: number;
  stats: Stats;
}) {
  const [items, setItems] = useState(initialItems);
  const [expandedId, setExpandedId] = useState<string | null>(items[0]?.id ?? null);
  const [activeFilter, setActiveFilter] = useState<QueueFilter>("needs_action");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const classifiedItems = useMemo(
    () =>
      items.map((item) => ({
        item,
        classification: classifyIssueReport(item),
      })),
    [items],
  );
  const localSummary = useMemo(() => summarizeIssueReportQueue(items), [items]);
  const queueSummary = stats.queueSummary ?? localSummary;

  const visibleItems = classifiedItems.filter(({ classification }) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "needs_action") return classification.isActionable;
    return classification.category === activeFilter;
  });

  function handleStatusChange(reportId: string, newStatus: IssueReportStatus) {
    startTransition(async () => {
      await updateIssueReportStatus(reportId, newStatus);
      setItems((prev) =>
        prev.map((report) => (report.reportId === reportId ? { ...report, status: newStatus } : report)),
      );
    });
  }

  function handleSendToFix(reportId: string) {
    startTransition(async () => {
      const result = await sendIssueReportToBuildStudioAsFix(reportId);
      if (result.status === "blocked") {
        setSendError(`${reportId}: ${result.error}`);
        return;
      }
      setSendError(null);
      // The report is now triaged_local; reflect it locally before navigating.
      setItems((prev) =>
        prev.map((report) =>
          report.reportId === reportId ? { ...report, status: ISSUE_REPORT_STATUS.TRIAGED_LOCAL } : report,
        ),
      );
      // Navigate to the new build. window.location keeps this component free of
      // a render-time router hook (which throws outside an app-router context,
      // e.g. in the server-rendered admin panel unit test).
      if (typeof window !== "undefined") window.location.assign(result.href);
    });
  }

  function handleAskAdmin(report: ReportRow) {
    const classification = classifyIssueReport(report);
    document.dispatchEvent(
      new CustomEvent("open-agent-panel", {
        detail: {
          autoMessage: buildAdminPrompt(report, classification.category),
        },
      }),
    );
  }

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Needs action" value={queueSummary.actionable} intent="danger" />
        <StatCard label="Process guard" value={queueSummary.processGuard} intent="accent" />
        <StatCard label="Warmup noise" value={queueSummary.warmupNoise} intent="warning" />
        <StatCard label="Triaged" value={queueSummary.triaged} intent="warning" />
        <StatCard label="Resolved" value={queueSummary.resolved} intent="success" />
        <StatCard label="Total" value={total} />
      </section>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-[var(--dpf-muted)]">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
            Queue posture
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <PostureBlock
              label="Action queue"
              value={queueSummary.actionable}
              detail="Open reports that need an admin investigation."
            />
            <PostureBlock
              label="Suppress candidates"
              value={queueSummary.warmupNoise}
              detail="Suppress warmup probes and health pings so they do not dominate triage."
            />
            <PostureBlock
              label="Recent volume"
              value={stats.last24h}
              detail={`${stats.last7d} reports in the last 7 days.`}
            />
          </div>
        </div>

        {stats.topRoutes.length > 0 && (
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <h3 className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">Top routes</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {stats.topRoutes.map((route) => (
                <span
                  key={route.route ?? "unknown"}
                  className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs text-[var(--dpf-text)]"
                >
                  {route.route ?? "(unknown)"}{" "}
                  <span className="text-[var(--dpf-muted)]">({route.count})</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {Object.keys(stats.bySeverity).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats.bySeverity).map(([severity, count]) => (
            <StatusBadge
              key={severity}
              domain="issueSeverity"
              status={severity}
              label={`${severity}: ${count}`}
              uppercase={false}
              size="md"
            />
          ))}
        </div>
      )}

      <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <div className="flex flex-col gap-3 border-b border-[var(--dpf-border)] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[var(--dpf-muted)]" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Issue queue</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setActiveFilter(filter.id)}
                className={[
                  "rounded-md border px-3 py-1.5 text-xs font-medium transition",
                  activeFilter === filter.id
                    ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)] text-white"
                    : "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]",
                ].join(" ")}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {visibleItems.length === 0 ? (
          <p className="p-4 text-sm text-[var(--dpf-muted)]">No reports match this queue view.</p>
        ) : (
          <div className="divide-y divide-[var(--dpf-border)]">
            {visibleItems.map(({ item }) => (
              <IssueReportRow
                key={item.id}
                report={item}
                expanded={expandedId === item.id}
                onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                onAskAdmin={() => handleAskAdmin(item)}
                onStatusChange={handleStatusChange}
                onSendToFix={handleSendToFix}
                isPending={isPending}
              />
            ))}
          </div>
        )}
        {sendError && (
          <p className="border-t border-[var(--dpf-border)] px-4 py-2 text-xs text-[var(--dpf-error)]">
            Could not send to Build Studio — {sendError}
          </p>
        )}
      </section>
    </div>
  );
}

function IssueReportRow({
  report,
  expanded,
  onToggle,
  onAskAdmin,
  onStatusChange,
  onSendToFix,
  isPending,
}: {
  report: ReportRow;
  expanded: boolean;
  onToggle: () => void;
  onAskAdmin: () => void;
  onStatusChange: (reportId: string, status: IssueReportStatus) => void;
  onSendToFix: (reportId: string) => void;
  isPending: boolean;
}) {
  const classification = classifyIssueReport(report);
  const explanation = explainIssueReport(report);
  const status = normalizeIssueReportStatus(report.status);
  const isCoworkerRegression = report.source === "coworker-regression-detector";
  const diagnosis = isCoworkerRegression ? parseCoworkerDiagnosis(report.description) : null;

  return (
    <article className="bg-[var(--dpf-surface-1)]">
      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <button type="button" onClick={onToggle} className="min-w-0 text-left">
          <div className="flex min-w-0 items-center gap-3">
            <StatusBadge
              domain="issueSeverity"
              status={report.severity}
              variant="soft"
              size="sm"
              className="shrink-0"
            />
            <span className="truncate font-mono text-xs text-[var(--dpf-muted)]">{report.reportId}</span>
            <span className="truncate text-sm font-medium text-[var(--dpf-text)]">{report.title}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--dpf-muted)]">
            <StatusBadge intent="neutral" label={classification.categoryLabel} size="sm" />
            <StatusBadge domain="issueStatus" status={status.bucket} label={status.label} size="sm" />
            {isCoworkerRegression && (
              <StatusBadge intent="accent" label="Coworker regression" size="sm" />
            )}
            <span>{report.source}</span>
            {report.routeContext && <span className="font-mono">{report.routeContext}</span>}
            <span>{new Date(report.createdAt).toLocaleString()}</span>
          </div>
        </button>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <button
            type="button"
            onClick={onAskAdmin}
            className="inline-flex items-center gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
          >
            <Bot className="h-3.5 w-3.5" aria-hidden="true" />
            Ask System Admin
          </button>
          {classification.category === "warmup_noise" && status.bucket !== "suppressed" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => onStatusChange(report.reportId, ISSUE_REPORT_STATUS.SUPPRESSED)}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-warning)] disabled:opacity-50"
            >
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
              Suppress
            </button>
          )}
          {status.isActive && classification.category !== "warmup_noise" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => onSendToFix(report.reportId)}
              title="Create a bug backlog item and start a fix-kind Build Studio build from this report"
              className="inline-flex items-center gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:opacity-50"
            >
              <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
              Send to Build Studio as a fix
            </button>
          )}
          {status.isActive && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => onStatusChange(report.reportId, ISSUE_REPORT_STATUS.TRIAGED_LOCAL)}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Triaged
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3">
          {/* Plain-language explanation for non-technical operators (BI-E42C0B7E).
              Shown first so a founder understands the report without reading a stack trace. */}
          <div className="rounded-md border border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] p-3">
            <h4 className="mb-1 text-[10px] font-semibold uppercase text-[var(--dpf-accent)]">What this means</h4>
            <p className="text-xs leading-5 text-[var(--dpf-text)]">{explanation.meaning}</p>
            <h4 className="mb-1 mt-3 text-[10px] font-semibold uppercase text-[var(--dpf-accent)]">What you can do</h4>
            <p className="text-xs leading-5 text-[var(--dpf-text)]">{explanation.whatToDo}</p>
          </div>

          {diagnosis && (
            <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge intent="accent" label="Coworker regression" size="sm" />
                {diagnosis.probableCause && (
                  <StatusBadge intent="danger" label={diagnosis.probableCause} size="sm" uppercase={false} />
                )}
              </div>
              {diagnosis.summary && (
                <p className="mt-2 text-xs leading-5 text-[var(--dpf-text)]">{diagnosis.summary}</p>
              )}
              {diagnosis.metrics.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                  {diagnosis.metrics.map(({ label, value }) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-[10px] font-semibold uppercase text-[var(--dpf-muted)]">{label}</dt>
                      <dd className="truncate font-mono text-xs text-[var(--dpf-text)]">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}

          {report.description && (
            <div>
              <h4 className="mb-1 text-[10px] font-semibold uppercase text-[var(--dpf-muted)]">Description</h4>
              <p className="whitespace-pre-wrap text-xs leading-5 text-[var(--dpf-text)]">{report.description}</p>
            </div>
          )}

          {report.errorStack && (
            <details>
              <summary className="cursor-pointer text-[10px] font-semibold uppercase text-[var(--dpf-muted)]">
                Technical detail (stack trace)
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 text-[10px] leading-relaxed text-[var(--dpf-muted)]">
                {report.errorStack}
              </pre>
            </details>
          )}

          {report.reportedBy && (
            <p className="text-[10px] text-[var(--dpf-muted)]">
              Reported by: {report.reportedBy.name ?? report.reportedBy.email ?? report.reportedBy.id}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {status.bucket !== "resolved" && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => onStatusChange(report.reportId, ISSUE_REPORT_STATUS.RESOLVED_LOCALLY)}
                className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:border-[var(--dpf-success)] disabled:opacity-50"
              >
                Resolve
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function PostureBlock({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div>
      <p className="text-2xl font-semibold text-[var(--dpf-text)]">{value}</p>
      <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">{label}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">{detail}</p>
    </div>
  );
}

type CoworkerDiagnosis = {
  probableCause: string | null;
  summary: string | null;
  metrics: Array<{ label: string; value: string }>;
};

// Parse the deterministic diagnosis block the detector writes into
// PlatformIssueReport.description (see coworker-regression-diagnosis.ts). The
// description is a stable "Key: value" line format; we surface a scannable
// subset as operator evidence and leave the full text in the Description panel.
function parseCoworkerDiagnosis(description: string | null): CoworkerDiagnosis | null {
  if (!description) return null;

  const fields = new Map<string, string>();
  for (const line of description.split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (key && value && !fields.has(key)) fields.set(key, value);
  }

  const probableCause = fields.get("probable cause") ?? fields.get("diagnosis") ?? null;
  const summary = fields.get("summary") ?? null;

  const metricSpecs: Array<{ key: string; label: string }> = [
    { key: "recent p95", label: "Recent p95" },
    { key: "baseline p95", label: "Baseline p95" },
    { key: "ratio", label: "Ratio" },
    { key: "recent nudge rate", label: "Recent nudge rate" },
    { key: "baseline nudge rate", label: "Baseline nudge rate" },
    { key: "dispatches", label: "Dispatches" },
    { key: "nudges", label: "Nudges" },
    { key: "tools attached", label: "Tools attached" },
    { key: "executed tools", label: "Executed tools" },
    { key: "provider", label: "Provider" },
    { key: "model", label: "Model" },
  ];

  const metrics = metricSpecs
    .filter((spec) => fields.has(spec.key))
    .map((spec) => ({ label: spec.label, value: fields.get(spec.key) as string }));

  if (!probableCause && !summary && metrics.length === 0) return null;
  return { probableCause, summary, metrics };
}

function buildAdminPrompt(report: ReportRow, category: IssueReportCategory): string {
  return [
    "Triage this admin issue report using backend evidence. Do not use Build Studio.",
    `Report: ${report.reportId}`,
    `Title: ${report.title}`,
    `Category: ${category}`,
    `Status: ${report.status}`,
    `Severity: ${report.severity}`,
    `Source: ${report.source}`,
    report.routeContext ? `Route: ${report.routeContext}` : "Route: unknown",
    report.description ? `Description: ${report.description.slice(0, 1200)}` : "Description: none",
    "Use admin_query_db for PlatformIssueReport and ToolExecution evidence, admin_view_logs for portal logs when relevant, and admin_read_file for source inspection. Return the actionable cause, recommended status, and whether this needs a PR.",
  ].join("\n");
}
