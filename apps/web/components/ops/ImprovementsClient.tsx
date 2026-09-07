"use client";

// Improvements EVIDENCE view (EP-INTAKE-UNIFY Phase 6, BI-196693D6).
//
// An improvement proposal is evidence of observed friction; the WORK is tracked
// in the backlog. This view is read-only with respect to lifecycle: it shows
// each proposal's linked BacklogItem status (the single canonical lifecycle) and
// links to the backlog row, where triage / prioritize / build / defer happen.
// There is no competing proposed→reviewed→prioritized workflow here anymore.

import Link from "next/link";
import { useState } from "react";

import { StatusBadge, FilterBar } from "@/components/ui/report-kit";
import type { ImprovementEvidenceRow } from "@/lib/evaluate/improvement-data";

const CATEGORY_LABELS: Record<string, string> = {
  ux_friction: "UX Friction",
  missing_feature: "Missing Feature",
  performance: "Performance",
  accessibility: "Accessibility",
  security: "Security",
  process: "Process",
};

// The canonical backlog lifecycle (mirrors BACKLOG_STATUS_VALUES). The former
// improvement-status filter is gone — you filter by where the WORK actually is.
const BACKLOG_STATUS_OPTIONS = [
  { value: "triaging", label: "Triaging" },
  { value: "open", label: "Open" },
  { value: "in-progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "deferred", label: "Deferred" },
  { value: "retired", label: "Retired" },
];

type Props = {
  proposals: ImprovementEvidenceRow[];
};

export function ImprovementsClient({ proposals }: Props) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const statusFilter = filters.status ?? "";

  const filtered = statusFilter
    ? proposals.filter((p) => (p.backlogStatus ?? "") === statusFilter)
    : proposals;

  return (
    <div>
      <FilterBar
        mode="client"
        facets={[
          {
            kind: "pills",
            key: "status",
            label: "Backlog status",
            options: BACKLOG_STATUS_OPTIONS,
          },
        ]}
        value={filters}
        onChange={setFilters}
        resultCount={filtered.length}
        className="mb-4"
      />

      {filtered.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)] py-8 text-center">
          No improvement evidence
          {statusFilter
            ? ` whose backlog item is "${statusFilter.replace("-", " ")}"`
            : " yet"}
          .
        </p>
      )}

      <div className="space-y-3">
        {filtered.map((p) => (
          <div
            key={p.id}
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[10px] font-mono text-[var(--dpf-muted)]">
                    {p.proposalId}
                  </span>
                  {p.backlogStatus ? (
                    <StatusBadge domain="backlogItem" status={p.backlogStatus} variant="soft" />
                  ) : (
                    <span className="text-[10px] italic text-[var(--dpf-muted)]">
                      filing to backlog…
                    </span>
                  )}
                  <StatusBadge domain="severity" status={p.severity} variant="outline" />
                </div>
                <h3 className="text-sm font-semibold text-[var(--dpf-text)] leading-snug">
                  {p.title}
                </h3>
              </div>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                style={{
                  background: "color-mix(in srgb, var(--dpf-accent) 15%, transparent)",
                  color: "var(--dpf-accent)",
                }}
              >
                {CATEGORY_LABELS[p.category] ?? p.category}
              </span>
            </div>

            {/* Description */}
            <p className="text-xs text-[var(--dpf-muted)] mb-2 line-clamp-3">{p.description}</p>

            {/* Observed friction — the evidence */}
            {p.observedFriction && (
              <div className="text-[11px] text-[var(--dpf-muted)] mb-2 pl-3 border-l-2 border-[var(--dpf-border)] italic">
                {p.observedFriction}
              </div>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-3 text-[10px] text-[var(--dpf-muted)] mb-3 flex-wrap">
              <span>By: {p.submittedByEmail}</span>
              <span>Agent: {p.agentId}</span>
              <span>Page: {p.routeContext}</span>
              <span>{new Date(p.createdAt).toLocaleDateString()}</span>
            </div>

            {/* The proposal is evidence; the work lives in the backlog. The only
                action is to open the canonical backlog row. */}
            {p.backlogItemId ? (
              <Link
                href={`/ops?itemId=${p.backlogItemId}`}
                className="text-[11px] text-[var(--dpf-accent)] hover:underline"
              >
                View backlog item {p.backlogItemId} →
              </Link>
            ) : (
              <span className="text-[11px] text-[var(--dpf-muted)]">
                Backlog item is being filed…
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
