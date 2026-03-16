"use client";

import { useState, useTransition } from "react";
import type { ImprovementRow } from "@/lib/improvement-data";
import {
  reviewImprovement,
  prioritizeImprovement,
  startImprovement,
  completeImprovement,
  rejectImprovement,
  verifyImprovement,
} from "@/lib/actions/improvements";

const STATUS_COLOURS: Record<string, string> = {
  proposed: "#38bdf8",
  reviewed: "#a78bfa",
  prioritized: "#fb923c",
  in_progress: "#fbbf24",
  implemented: "#4ade80",
  verified: "#10b981",
  rejected: "#ef4444",
};

const CATEGORY_LABELS: Record<string, string> = {
  ux_friction: "UX Friction",
  missing_feature: "Missing Feature",
  performance: "Performance",
  accessibility: "Accessibility",
  security: "Security",
  process: "Process",
};

const SEVERITY_COLOURS: Record<string, string> = {
  low: "#8888a0",
  medium: "#38bdf8",
  high: "#fb923c",
  critical: "#ef4444",
};

const STATUS_FILTERS = ["all", "proposed", "reviewed", "prioritized", "in_progress", "implemented", "verified", "rejected"] as const;

type Props = {
  proposals: ImprovementRow[];
};

export function ImprovementsClient({ proposals }: Props) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const filtered = statusFilter === "all"
    ? proposals
    : proposals.filter((p) => p.status === statusFilter);

  function handleAction(action: () => Promise<unknown>) {
    startTransition(async () => {
      await action();
    });
  }

  return (
    <div>
      {/* Status filter bar */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {STATUS_FILTERS.map((s) => {
          const count = s === "all" ? proposals.length : proposals.filter((p) => p.status === s).length;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={[
                "px-2.5 py-1 text-[11px] rounded-full border transition-colors",
                statusFilter === s
                  ? "border-[var(--dpf-accent)] text-white bg-[var(--dpf-accent)]/20"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white",
              ].join(" ")}
            >
              {s === "all" ? "All" : s.replace("_", " ")} ({count})
            </button>
          );
        })}
      </div>

      {/* Proposals list */}
      {filtered.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)] py-8 text-center">
          No improvement proposals {statusFilter !== "all" ? `with status "${statusFilter.replace("_", " ")}"` : "yet"}.
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
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono text-[var(--dpf-muted)]">{p.proposalId}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{ background: `${STATUS_COLOURS[p.status] ?? "#888"}22`, color: STATUS_COLOURS[p.status] ?? "#888" }}
                  >
                    {p.status.replace("_", " ")}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ color: SEVERITY_COLOURS[p.severity] ?? "#888" }}
                  >
                    {p.severity}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-white leading-snug">{p.title}</h3>
              </div>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                style={{ background: "rgba(124,140,248,0.15)", color: "#7c8cf8" }}
              >
                {CATEGORY_LABELS[p.category] ?? p.category}
              </span>
            </div>

            {/* Description */}
            <p className="text-xs text-[var(--dpf-muted)] mb-2 line-clamp-3">{p.description}</p>

            {/* Observed friction */}
            {p.observedFriction && (
              <div className="text-[11px] text-[var(--dpf-muted)] mb-2 pl-3 border-l-2 border-[var(--dpf-border)] italic">
                {p.observedFriction}
              </div>
            )}

            {/* Meta row */}
            <div className="flex items-center gap-3 text-[10px] text-[var(--dpf-muted)] mb-3">
              <span>By: {p.submittedByEmail}</span>
              <span>Agent: {p.agentId}</span>
              <span>Page: {p.routeContext}</span>
              <span>{new Date(p.createdAt).toLocaleDateString()}</span>
            </div>

            {/* Rejection reason */}
            {p.status === "rejected" && p.rejectionReason && (
              <div className="text-[11px] text-red-400 mb-2">
                Rejected: {p.rejectionReason}
              </div>
            )}

            {/* Backlog link */}
            {p.backlogItemId && (
              <div className="text-[11px] text-[var(--dpf-accent)] mb-2">
                Linked to backlog item {p.backlogItemId}
              </div>
            )}

            {/* Action buttons based on status */}
            <div className="flex gap-2 flex-wrap">
              {p.status === "proposed" && (
                <>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleAction(() => reviewImprovement(p.proposalId))}
                    className="px-2.5 py-1 text-[11px] rounded border border-purple-500/40 text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-50"
                  >
                    Mark Reviewed
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setRejectId(rejectId === p.proposalId ? null : p.proposalId)}
                    className="px-2.5 py-1 text-[11px] rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    Reject
                  </button>
                </>
              )}
              {p.status === "reviewed" && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleAction(() => prioritizeImprovement(p.proposalId))}
                  className="px-2.5 py-1 text-[11px] rounded border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 transition-colors disabled:opacity-50"
                >
                  Prioritize (create backlog item)
                </button>
              )}
              {p.status === "prioritized" && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleAction(() => startImprovement(p.proposalId))}
                  className="px-2.5 py-1 text-[11px] rounded border border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10 transition-colors disabled:opacity-50"
                >
                  Start Work
                </button>
              )}
              {p.status === "in_progress" && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleAction(() => completeImprovement(p.proposalId))}
                  className="px-2.5 py-1 text-[11px] rounded border border-green-500/40 text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50"
                >
                  Mark Implemented
                </button>
              )}
              {p.status === "implemented" && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleAction(() => verifyImprovement(p.proposalId))}
                  className="px-2.5 py-1 text-[11px] rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                >
                  Verify (confirm fix works)
                </button>
              )}
            </div>

            {/* Reject reason input */}
            {rejectId === p.proposalId && (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  placeholder="Rejection reason..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="flex-1 px-2 py-1 text-[11px] rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-white placeholder:text-[var(--dpf-muted)]"
                />
                <button
                  type="button"
                  disabled={isPending || !rejectReason.trim()}
                  onClick={() => {
                    handleAction(async () => {
                      await rejectImprovement(p.proposalId, rejectReason.trim());
                      setRejectId(null);
                      setRejectReason("");
                    });
                  }}
                  className="px-2.5 py-1 text-[11px] rounded bg-red-500/20 border border-red-500/40 text-red-400 disabled:opacity-50"
                >
                  Confirm Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
