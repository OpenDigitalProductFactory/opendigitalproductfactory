"use client";

// RecruitingPipelinePanel (BI-9CC44DC7) — the client surface for the recruiting
// pipeline page. Renders the unified funnel read model (native + Greenhouse-
// sourced, deduped) with a count trio, by-stage summary, source-badged list,
// and a requisition filter. Read-only: the filter re-reads server-side via the
// ?requisitionId= param so the page and the coworker tool share one read model.

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import type { RecruitingPipeline } from "@/lib/recruiting/pipeline-read-model";
import type { RequisitionOption } from "@/lib/recruiting/requisitions-read-model";

type Props = {
  pipeline: RecruitingPipeline;
  requisitions: RequisitionOption[];
  selectedRequisitionId: string | null;
};

const UNSTAGED = "Unstaged";

function stageCounts(pipeline: RecruitingPipeline): Array<{ stage: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of pipeline.items) {
    const key = item.stage ?? UNSTAGED;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([stage, count]) => ({ stage, count }));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function RecruitingPipelinePanel({
  pipeline,
  requisitions,
  selectedRequisitionId,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onRequisitionChange(value: string) {
    const query = value ? `?requisitionId=${encodeURIComponent(value)}` : "";
    startTransition(() => router.push(`/employee/recruiting${query}`));
  }

  const stages = stageCounts(pipeline);
  const { native, greenhouse, total } = pipeline.counts;

  return (
    <div className="space-y-5" aria-busy={isPending}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="In the funnel" value={total} />
        <MetricCard label="Native" value={native} />
        <MetricCard label="From Greenhouse" value={greenhouse} hint="not yet promoted" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="requisition-filter"
          className="text-xs text-[var(--dpf-muted)]"
        >
          Requisition
        </label>
        <select
          id="requisition-filter"
          value={selectedRequisitionId ?? ""}
          disabled={isPending}
          onChange={(e) => onRequisitionChange(e.target.value)}
          className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface)] px-2 py-1 text-sm text-[var(--dpf-text)]"
        >
          <option value="">All requisitions</option>
          {requisitions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.reqId} &middot; {r.title}
              {r.status !== "open" ? ` (${r.status})` : ""}
            </option>
          ))}
        </select>
      </div>

      {stages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--dpf-muted)]">By stage</span>
          {stages.map((s) => (
            <span
              key={s.stage}
              className="rounded-full bg-[var(--dpf-accent-soft)] px-3 py-1 text-xs text-[var(--dpf-accent)]"
            >
              {s.stage} &middot; {s.count}
            </span>
          ))}
        </div>
      )}

      {pipeline.items.length === 0 ? (
        <div className="rounded-xl border border-[var(--dpf-border)] p-8 text-center text-sm text-[var(--dpf-muted)]">
          No applications in this funnel yet.
          {selectedRequisitionId
            ? " Try clearing the requisition filter."
            : " Native applications and Greenhouse-sourced candidates will appear here as they arrive."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--dpf-border)]">
          <div className="grid grid-cols-[2fr_1fr_1.2fr_0.9fr] gap-3 border-b border-[var(--dpf-border)] bg-[var(--dpf-surface)] px-4 py-2 text-xs text-[var(--dpf-muted)]">
            <div>Candidate</div>
            <div>Source</div>
            <div>Stage</div>
            <div>Status</div>
          </div>
          <ul>
            {pipeline.items.map((item) => (
              <li
                key={item.id}
                className="grid grid-cols-[2fr_1fr_1.2fr_0.9fr] items-center gap-3 border-b border-[var(--dpf-border)] px-4 py-3 text-sm last:border-b-0"
              >
                <span className="flex items-center gap-2 text-[var(--dpf-text)]">
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--dpf-accent-soft)] text-xs text-[var(--dpf-accent)]"
                  >
                    {initials(item.displayName)}
                  </span>
                  {item.displayName}
                </span>
                <span>
                  <SourceBadge source={item.source} />
                </span>
                <span className="text-[var(--dpf-muted)]">{item.stage ?? "—"}</span>
                <span className="text-[var(--dpf-muted)]">{item.status ?? "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-[var(--dpf-muted)]">
        Greenhouse-sourced rows are read-only until promoted to a native candidate; a promoted
        candidate drops off the Greenhouse side automatically (crosswalk dedupe).
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg bg-[var(--dpf-surface)] p-4">
      <div className="mb-1 text-xs text-[var(--dpf-muted)]">
        {label}
        {hint ? <span className="ml-1 text-[var(--dpf-muted)]">&middot; {hint}</span> : null}
      </div>
      <div className="text-2xl font-medium text-[var(--dpf-text)]">{value}</div>
    </div>
  );
}

function SourceBadge({ source }: { source: "native" | "greenhouse" }) {
  if (source === "native") {
    return (
      <span
        className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs"
        style={{
          backgroundColor: "var(--dpf-accent-soft)",
          color: "var(--dpf-success)",
        }}
      >
        Native
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs"
      style={{
        backgroundColor: "var(--dpf-accent-soft)",
        color: "var(--dpf-warning)",
      }}
    >
      Greenhouse
    </span>
  );
}
