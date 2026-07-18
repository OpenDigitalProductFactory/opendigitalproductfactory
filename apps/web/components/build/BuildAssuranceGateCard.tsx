"use client";

import { Clock3, RefreshCw, ScanLine, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import {
  requestBuildAssuranceScan,
  requestBuildBomGeneration,
} from "@/lib/actions/assurance";
import type { BomSummary } from "@/lib/assurance/bom-read";
import type { ActiveAssuranceFindingRow } from "@/lib/assurance/finding-read";
import { buildTrustMessage } from "@/lib/trust-vector";
import { TrustBadge } from "@/components/ui/TrustBadge";
import { Spinner } from "@/components/ui/Spinner";
import { AssuranceFindingsList } from "./AssuranceFindingsList";

type RequestState = "idle" | "queued" | "failed";

function formatGeneratedAt(value: Date | string | null | undefined): string {
  if (!value) return "not generated";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "not generated";
  return date.toLocaleString();
}

function statusLabel(summary: BomSummary): string {
  if (summary.state === "missing") return "No BOM generated";
  if (summary.findings.blocking > 0) return "Assurance blocked";
  if (summary.scanner.state === "needs-evaluation") return "Scanner not approved";
  if (summary.state === "current") return "BOM current";
  if (summary.state === "stale") return "BOM stale";
  return "No BOM generated";
}

function statusTone(summary: BomSummary): string {
  if (summary.findings.blocking > 0) return "text-[var(--dpf-error)]";
  if (summary.scanner.state === "needs-evaluation") return "text-[var(--dpf-warning)]";
  if (summary.state === "current") return "text-[var(--dpf-success)]";
  if (summary.state === "stale") return "text-[var(--dpf-warning)]";
  return "text-[var(--dpf-muted)]";
}

function scannerDetail(summary: BomSummary): string {
  if (summary.scanner.state === "ready") {
    return summary.scanner.scannerNames.join(", ");
  }

  return "No approved vulnerability scanner";
}

function emptyFindingsLabel(summary: BomSummary, hasBom: boolean): string {
  if (!hasBom) return "Generate a BOM, then run a scan.";

  if (summary.trust && summary.findings.total === 0) {
    return buildTrustMessage(summary.trust, {
      currentFact: "No active findings.",
      lastKnownFact: "No active findings in the latest scan.",
      lowConfidenceResult: "No active findings in the latest scan.",
    });
  }

  return "No active findings.";
}

export function BuildAssuranceGateCard({
  buildId,
  summary,
  findings = [],
}: {
  buildId: string;
  summary: BomSummary;
  findings?: ActiveAssuranceFindingRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [scanPending, startScanTransition] = useTransition();
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [scanRequestState, setScanRequestState] = useState<RequestState>("idle");
  const hasBom = Boolean(summary.state !== "missing" && summary.document);
  const StatusIcon = summary.findings.blocking > 0
    ? ShieldAlert
    : hasBom && summary.scanner.state === "ready"
      ? ShieldCheck
      : TriangleAlert;
  const statusColor = statusTone(summary);
  const modelLabel = `${summary.counts.models} AI model${summary.counts.models === 1 ? "" : "s"}`;
  const findingLabel = summary.findings.blocking > 0
    ? `${summary.findings.blocking} blocking`
    : `${summary.findings.total} active`;
  const buttonLabel = pending ? "Queueing" : requestState === "queued" ? "Queued" : "Generate BOM";
  const scanButtonLabel = scanPending
    ? "Queueing"
    : scanRequestState === "queued"
      ? "Scan queued"
      : "Run scan";
  const scanDisabled = !hasBom || scanPending;

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
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className={`text-xs font-medium ${statusColor}`}>{statusLabel(summary)}</p>
            {summary.trust && <TrustBadge trust={summary.trust} compact />}
          </div>
        </div>
        <div className="flex items-center gap-2">
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
            {pending ? (
              <Spinner size="xs" tone="current" presentational />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {buttonLabel}
          </button>
          <button
            type="button"
            data-testid="build-assurance-gate-run-scan"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 text-xs font-medium text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={scanDisabled}
            onClick={() => {
              setScanRequestState("idle");
              startScanTransition(() => {
                void requestBuildAssuranceScan(buildId)
                  .then(() => setScanRequestState("queued"))
                  .catch(() => setScanRequestState("failed"));
              });
            }}
          >
            {scanPending ? (
              <Spinner size="xs" tone="current" presentational />
            ) : (
              <ScanLine className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {scanButtonLabel}
          </button>
        </div>
      </div>

      <dl className="mt-3 grid min-h-20 grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--dpf-border)] pt-3 text-xs">
        <div className="min-w-0">
          <dt className="text-[var(--dpf-muted)]">Components</dt>
          <dd className="mt-1 truncate font-semibold text-[var(--dpf-text)]">
            {summary.counts.components} components
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[var(--dpf-muted)]">Models</dt>
          <dd className="mt-1 truncate font-semibold text-[var(--dpf-text)]">{modelLabel}</dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1 text-[var(--dpf-muted)]">
            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
            Findings
          </dt>
          <dd className="mt-1 truncate font-semibold text-[var(--dpf-text)]">{findingLabel}</dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1 text-[var(--dpf-muted)]">
            <Clock3 className="h-3 w-3" aria-hidden="true" />
            Generated
          </dt>
          <dd className="mt-1 truncate font-semibold text-[var(--dpf-text)]">
            {formatGeneratedAt(summary.document?.generatedAt)}
          </dd>
        </div>
      </dl>

      <p className="mt-3 truncate border-t border-[var(--dpf-border)] pt-3 text-xs text-[var(--dpf-muted)]" title={scannerDetail(summary)}>
        {scannerDetail(summary)}
      </p>

      {(requestState === "failed" || scanRequestState === "failed") && (
        <p className="mt-2 text-xs text-[var(--dpf-error)]" role="status">
          Queue failed. Try again after the worker is available.
        </p>
      )}

      <div className="mt-3 border-t border-[var(--dpf-border)] pt-3">
        <p className="text-xs font-semibold text-[var(--dpf-text)]">Active findings</p>
        <p className="mt-0.5 text-[11px] text-[var(--dpf-muted)]">
          Genuine findings file backlog items automatically; accepted and already-fixed-on-main advisories are suppressed.
        </p>
        <div className="mt-2">
          <AssuranceFindingsList
            findings={findings}
            readOnly
            emptyLabel={emptyFindingsLabel(summary, hasBom)}
          />
        </div>
      </div>
    </section>
  );
}
