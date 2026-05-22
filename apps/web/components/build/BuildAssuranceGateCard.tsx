"use client";

import { Clock3, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { requestBuildBomGeneration } from "@/lib/actions/assurance";
import type { BomSummary } from "@/lib/assurance/bom-read";

type RequestState = "idle" | "queued" | "failed";

function formatGeneratedAt(value: Date | string | null | undefined): string {
  if (!value) return "not generated";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "not generated";
  return date.toLocaleString();
}

function statusLabel(summary: BomSummary): string {
  if (summary.state === "current") return "BOM current";
  if (summary.state === "stale") return "BOM stale";
  return "No BOM generated";
}

export function BuildAssuranceGateCard({
  buildId,
  summary,
}: {
  buildId: string;
  summary: BomSummary;
}) {
  const [pending, startTransition] = useTransition();
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const hasBom = summary.state !== "missing" && summary.document;
  const StatusIcon = hasBom ? ShieldCheck : TriangleAlert;
  const statusColor = summary.state === "current"
    ? "text-[var(--dpf-success)]"
    : summary.state === "stale"
      ? "text-[var(--dpf-warning)]"
      : "text-[var(--dpf-muted)]";
  const modelLabel = `${summary.counts.models} AI model${summary.counts.models === 1 ? "" : "s"}`;
  const buttonLabel = pending ? "Queueing" : requestState === "queued" ? "Queued" : "Generate BOM";

  return (
    <section
      data-testid="build-assurance-gate-card"
      className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 shadow-dpf-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--dpf-text)]">
            <StatusIcon className={`h-4 w-4 ${statusColor}`} aria-hidden="true" />
            <h2>Assurance Gate</h2>
          </div>
          <p className={`mt-1 text-xs font-medium ${statusColor}`}>{statusLabel(summary)}</p>
        </div>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-xs font-medium text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          onClick={() => {
            setRequestState("idle");
            startTransition(() => {
              void requestBuildBomGeneration(buildId)
                .then(() => setRequestState("queued"))
                .catch(() => setRequestState("failed"));
            });
          }}
        >
          <RefreshCw className={pending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden="true" />
          {buttonLabel}
        </button>
      </div>

      <dl className="mt-3 grid min-h-14 grid-cols-3 divide-x divide-[var(--dpf-border)] border-t border-[var(--dpf-border)] pt-3 text-xs">
        <div className="min-w-0 pr-3">
          <dt className="text-[var(--dpf-muted)]">Components</dt>
          <dd className="mt-1 truncate font-semibold text-[var(--dpf-text)]">
            {summary.counts.components} components
          </dd>
        </div>
        <div className="min-w-0 px-3">
          <dt className="text-[var(--dpf-muted)]">Models</dt>
          <dd className="mt-1 truncate font-semibold text-[var(--dpf-text)]">{modelLabel}</dd>
        </div>
        <div className="min-w-0 pl-3">
          <dt className="flex items-center gap-1 text-[var(--dpf-muted)]">
            <Clock3 className="h-3 w-3" aria-hidden="true" />
            Generated
          </dt>
          <dd className="mt-1 truncate font-semibold text-[var(--dpf-text)]">
            {formatGeneratedAt(summary.document?.generatedAt)}
          </dd>
        </div>
      </dl>

      {requestState === "failed" && (
        <p className="mt-2 text-xs text-[var(--dpf-error)]" role="status">
          Queue failed. Try again after the worker is available.
        </p>
      )}
    </section>
  );
}
