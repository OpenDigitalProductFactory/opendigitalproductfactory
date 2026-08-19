"use client";

import { AlertTriangle, CheckCircle2, GitBranch, Network } from "lucide-react";

import type { CodeGraphFreshness } from "@/lib/build/code-graph-access";
import { TrustBadge } from "@/components/ui/TrustBadge";

type Props = {
  freshness: CodeGraphFreshness | null;
};

function shortSha(value: string | null): string {
  return value ? value.slice(0, 12) : "no commit";
}

function formatIndexedAt(value: Date | string | null): string {
  if (!value) return "not indexed";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "not indexed";
  return date.toLocaleString();
}

export function CodeIntelligenceStatusCard({ freshness }: Props) {
  if (!freshness) {
    return (
      <section
        data-testid="code-intelligence-status-card"
        className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 shadow-dpf-xs"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--dpf-text)]">
          <Network className="h-4 w-4 text-[var(--dpf-muted)]" aria-hidden="true" />
          Code intelligence
        </div>
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">Loading graph status...</p>
      </section>
    );
  }

  const ready = freshness.available && freshness.indexStatus === "ready";
  const StatusIcon = ready ? CheckCircle2 : AlertTriangle;
  const statusColor = ready ? "text-[var(--dpf-success)]" : "text-[var(--dpf-warning)]";
  const trust = freshness.trust;
  const showTrustRationale = Boolean(
    trust && (trust.tier !== "high" || trust.action !== "present"),
  );

  return (
    <section
      data-testid="code-intelligence-status-card"
      className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 shadow-dpf-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--dpf-text)]">
            <Network className="h-4 w-4 text-[var(--dpf-muted)]" aria-hidden="true" />
            Code intelligence
          </div>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            {freshness.indexedFileCount.toLocaleString()} files indexed at {formatIndexedAt(freshness.lastIndexedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {trust && <TrustBadge trust={trust} compact />}
          <div className={`inline-flex items-center gap-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs font-medium ${statusColor}`}>
            <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {freshness.indexStatus}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-[var(--dpf-muted)] sm:grid-cols-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{freshness.lastIndexedBranch ?? "no branch"}</span>
        </div>
        <code className="truncate rounded bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[var(--dpf-muted)]">
          {shortSha(freshness.lastIndexedHeadSha)}
        </code>
      </div>

      {showTrustRationale && trust && (
        <p className="mt-3 text-xs text-[var(--dpf-muted)]">
          {trust.primaryRationale}
        </p>
      )}

      {freshness.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {freshness.warnings.map((warning) => (
            <li key={warning} className="flex gap-1.5 text-xs text-[var(--dpf-warning)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
