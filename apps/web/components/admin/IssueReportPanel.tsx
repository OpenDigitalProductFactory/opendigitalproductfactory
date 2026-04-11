"use client";

import { useState, useTransition } from "react";
import { updateIssueReportStatus } from "@/lib/actions/quality";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  last24h: number;
  last7d: number;
  topRoutes: Array<{ route: string | null; count: number }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_COLOURS: Record<string, string> = {
  critical: "var(--dpf-error, #ef4444)",
  high: "#fb923c",
  medium: "var(--dpf-warning, #fbbf24)",
  low: "var(--dpf-muted, #9ca3af)",
};

const STATUS_COLOURS: Record<string, string> = {
  open: "#f87171",
  acknowledged: "#fbbf24",
  resolved: "#4ade80",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleStatusChange(reportId: string, newStatus: "acknowledged" | "resolved") {
    startTransition(async () => {
      await updateIssueReportStatus(reportId, newStatus);
      setItems((prev) =>
        prev.map((r) => (r.reportId === reportId ? { ...r, status: newStatus } : r)),
      );
    });
  }

  const openCount = stats.byStatus["open"] ?? 0;
  const ackCount = stats.byStatus["acknowledged"] ?? 0;
  const resolvedCount = stats.byStatus["resolved"] ?? 0;

  return (
    <div>
      {/* ── Summary Cards ────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Open" value={openCount} color={STATUS_COLOURS.open} />
        <StatCard label="Acknowledged" value={ackCount} color={STATUS_COLOURS.acknowledged} />
        <StatCard label="Resolved" value={resolvedCount} color={STATUS_COLOURS.resolved} />
        <StatCard label="Last 24h" value={stats.last24h} />
        <StatCard label="Last 7d" value={stats.last7d} />
        <StatCard label="Total" value={total} />
      </div>

      {/* ── Top Routes ───────────────────────────────────────────── */}
      {stats.topRoutes.length > 0 && (
        <div className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[rgba(26,26,46,0.6)] p-4">
          <h3 className="mb-2 text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider">
            Top Error Routes
          </h3>
          <div className="flex flex-wrap gap-3">
            {stats.topRoutes.map((r) => (
              <span
                key={r.route}
                className="rounded bg-[rgba(15,15,26,0.8)] px-2 py-1 text-xs text-[var(--dpf-text)]"
              >
                {r.route ?? "(unknown)"}{" "}
                <span className="text-[var(--dpf-muted)]">({r.count})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Severity Distribution ────────────────────────────────── */}
      {Object.keys(stats.bySeverity).length > 0 && (
        <div className="mb-6 flex gap-3">
          {Object.entries(stats.bySeverity).map(([sev, count]) => (
            <span
              key={sev}
              className="rounded px-2 py-1 text-xs"
              style={{
                color: SEVERITY_COLOURS[sev] ?? "var(--dpf-text)",
                border: `1px solid ${SEVERITY_COLOURS[sev] ?? "var(--dpf-border)"}`,
              }}
            >
              {sev}: {count}
            </span>
          ))}
        </div>
      )}

      {/* ── Report List ──────────────────────────────────────────── */}
      {items.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No issue reports found.</p>
      ) : (
        <div className="space-y-2">
          {items.map((r) => {
            const isExpanded = expandedId === r.id;
            return (
              <div
                key={r.id}
                className="rounded-lg border border-[var(--dpf-border)] bg-[rgba(26,26,46,0.6)]"
              >
                {/* Row header */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  {/* Severity dot */}
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: SEVERITY_COLOURS[r.severity] ?? "var(--dpf-muted)" }}
                    title={r.severity}
                  />

                  {/* Report ID */}
                  <span className="shrink-0 text-xs font-mono text-[var(--dpf-muted)]">
                    {r.reportId}
                  </span>

                  {/* Title */}
                  <span className="flex-1 truncate text-sm text-[var(--dpf-text)]">
                    {r.title}
                  </span>

                  {/* Status badge */}
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                    style={{
                      color: STATUS_COLOURS[r.status] ?? "var(--dpf-muted)",
                      border: `1px solid ${STATUS_COLOURS[r.status] ?? "var(--dpf-border)"}`,
                    }}
                  >
                    {r.status}
                  </span>

                  {/* Source badge */}
                  <span className="shrink-0 text-[10px] text-[var(--dpf-muted)]">
                    {r.source}
                  </span>

                  {/* Route */}
                  {r.routeContext && (
                    <span className="shrink-0 text-[10px] font-mono text-[var(--dpf-muted)]">
                      {r.routeContext}
                    </span>
                  )}

                  {/* Time */}
                  <span className="shrink-0 text-[10px] text-[var(--dpf-muted)]">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-[var(--dpf-border)] px-4 py-3 space-y-3">
                    {r.description && (
                      <div>
                        <h4 className="text-[10px] font-semibold text-[var(--dpf-muted)] uppercase mb-1">
                          Description
                        </h4>
                        <p className="text-xs text-[var(--dpf-text)] whitespace-pre-wrap">
                          {r.description}
                        </p>
                      </div>
                    )}

                    {r.errorStack && (
                      <div>
                        <h4 className="text-[10px] font-semibold text-[var(--dpf-muted)] uppercase mb-1">
                          Stack Trace
                        </h4>
                        <pre className="max-h-48 overflow-auto rounded bg-[rgba(15,15,26,0.8)] p-2 text-[10px] text-[var(--dpf-muted)] leading-relaxed">
                          {r.errorStack}
                        </pre>
                      </div>
                    )}

                    {r.reportedBy && (
                      <p className="text-[10px] text-[var(--dpf-muted)]">
                        Reported by: {r.reportedBy.name ?? r.reportedBy.email ?? r.reportedBy.id}
                      </p>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      {r.status === "open" && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleStatusChange(r.reportId, "acknowledged")}
                          className="rounded bg-[rgba(251,191,36,0.15)] px-3 py-1 text-xs text-[#fbbf24] hover:bg-[rgba(251,191,36,0.25)] disabled:opacity-50"
                        >
                          Acknowledge
                        </button>
                      )}
                      {(r.status === "open" || r.status === "acknowledged") && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleStatusChange(r.reportId, "resolved")}
                          className="rounded bg-[rgba(74,222,128,0.15)] px-3 py-1 text-xs text-[#4ade80] hover:bg-[rgba(74,222,128,0.25)] disabled:opacity-50"
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[rgba(26,26,46,0.6)] p-3">
      <p className="text-[10px] font-semibold text-[var(--dpf-muted)] uppercase tracking-wider">
        {label}
      </p>
      <p className="text-xl font-bold" style={{ color: color ?? "var(--dpf-text)" }}>
        {value}
      </p>
    </div>
  );
}
