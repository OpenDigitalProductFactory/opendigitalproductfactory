"use client";

import { useMemo, useState, useTransition } from "react";
import { Archive, Bot, CheckCircle2, Filter, ShieldAlert } from "lucide-react";
import { updateIssueReportStatus } from "@/lib/actions/quality";
import { ISSUE_REPORT_STATUS, type IssueReportStatus } from "@/lib/quality/issue-report-status";
import {
  classifyIssueReport,
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
        <StatCard label="Needs action" value={queueSummary.actionable} tone="var(--dpf-error)" />
        <StatCard label="Process guard" value={queueSummary.processGuard} tone="var(--dpf-accent)" />
        <StatCard label="Warmup noise" value={queueSummary.warmupNoise} tone="var(--dpf-warning)" />
        <StatCard label="Triaged" value={queueSummary.triaged} tone="var(--dpf-warning)" />
        <StatCard label="Resolved" value={queueSummary.resolved} tone="var(--dpf-success)" />
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
          {Object.entries(stats.bySeverity).map(([severity, count]) => {
            const tone = toneForSeverity(severity);
            return (
              <span
                key={severity}
                className="rounded-md border px-2 py-1 text-xs"
                style={{ color: tone, borderColor: tone }}
              >
                {severity}: {count}
              </span>
            );
          })}
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
                isPending={isPending}
              />
            ))}
          </div>
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
  isPending,
}: {
  report: ReportRow;
  expanded: boolean;
  onToggle: () => void;
  onAskAdmin: () => void;
  onStatusChange: (reportId: string, status: IssueReportStatus) => void;
  isPending: boolean;
}) {
  const classification = classifyIssueReport(report);
  const status = normalizeIssueReportStatus(report.status);
  const severityTone = toneForSeverity(report.severity);
  const statusTone = toneForStatusBucket(status.bucket);

  return (
    <article className="bg-[var(--dpf-surface-1)]">
      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <button type="button" onClick={onToggle} className="min-w-0 text-left">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: severityTone }}
              title={report.severity}
            />
            <span className="truncate font-mono text-xs text-[var(--dpf-muted)]">{report.reportId}</span>
            <span className="truncate text-sm font-medium text-[var(--dpf-text)]">{report.title}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--dpf-muted)]">
            <Badge label={classification.categoryLabel} />
            <Badge label={status.label} tone={statusTone} />
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
          {report.description && (
            <div>
              <h4 className="mb-1 text-[10px] font-semibold uppercase text-[var(--dpf-muted)]">Description</h4>
              <p className="whitespace-pre-wrap text-xs leading-5 text-[var(--dpf-text)]">{report.description}</p>
            </div>
          )}

          {report.errorStack && (
            <div>
              <h4 className="mb-1 text-[10px] font-semibold uppercase text-[var(--dpf-muted)]">Stack trace</h4>
              <pre className="max-h-48 overflow-auto rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 text-[10px] leading-relaxed text-[var(--dpf-muted)]">
                {report.errorStack}
              </pre>
            </div>
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

function StatCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <p className="text-[10px] font-semibold uppercase text-[var(--dpf-muted)]">{label}</p>
      <p className="text-xl font-bold text-[var(--dpf-text)]" style={tone ? { color: tone } : undefined}>
        {value}
      </p>
    </div>
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

function Badge({ label, tone }: { label: string; tone?: string }) {
  return (
    <span
      className="rounded-md border border-[var(--dpf-border)] px-1.5 py-0.5 font-semibold uppercase"
      style={tone ? { color: tone, borderColor: tone } : undefined}
    >
      {label}
    </span>
  );
}

function toneForSeverity(severity: string): string {
  switch (severity) {
    case "critical":
    case "high":
      return "var(--dpf-error)";
    case "medium":
      return "var(--dpf-warning)";
    default:
      return "var(--dpf-muted)";
  }
}

function toneForStatusBucket(bucket: string): string {
  switch (bucket) {
    case "needs_action":
      return "var(--dpf-error)";
    case "resolved":
      return "var(--dpf-success)";
    case "suppressed":
      return "var(--dpf-muted)";
    default:
      return "var(--dpf-warning)";
  }
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
