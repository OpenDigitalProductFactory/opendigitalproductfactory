"use client";

import { useState, useTransition } from "react";
import { AlertOctagon, AlertTriangle, FilePlus, Info } from "lucide-react";
import type { ActiveAssuranceFindingRow } from "@/lib/assurance/finding-read";
import type { AssuranceFindingStatus } from "@/lib/assurance/types";
import {
  requestBacklogFromAssuranceFinding,
  setAssuranceFindingStatus,
} from "@/lib/actions/assurance";

const STATUS_OPTIONS: AssuranceFindingStatus[] = [
  "open",
  "accepted",
  "planned",
  "blocked",
  "resolved",
  "false-positive",
  "deferred",
];

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

const SEVERITY_TONE: Record<string, string> = {
  critical: "text-[var(--dpf-error)]",
  high: "text-[var(--dpf-error)]",
  medium: "text-[var(--dpf-warning)]",
  low: "text-[var(--dpf-muted)]",
  info: "text-[var(--dpf-muted)]",
};

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "critical" || severity === "high") {
    return <AlertOctagon className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  if (severity === "medium") {
    return <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  return <Info className="h-3.5 w-3.5" aria-hidden="true" />;
}

function componentLabel(finding: ActiveAssuranceFindingRow): string {
  if (finding.component) {
    return finding.component.version
      ? `${finding.component.name}@${finding.component.version}`
      : finding.component.name;
  }
  return finding.affectedId;
}

interface FindingRowProps {
  finding: ActiveAssuranceFindingRow;
  readOnly?: boolean;
}

function FindingRow({ finding, readOnly }: FindingRowProps) {
  const [status, setStatus] = useState<AssuranceFindingStatus>(finding.status as AssuranceFindingStatus);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [backlogItemId, setBacklogItemId] = useState<string | null>(null);

  const tone = SEVERITY_TONE[finding.policySeverity] ?? "text-[var(--dpf-muted)]";

  return (
    <li
      data-testid="assurance-finding-row"
      className="flex flex-col gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 text-xs"
    >
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 inline-flex items-center gap-1 font-semibold ${tone}`}>
          <SeverityIcon severity={finding.policySeverity} />
          {SEVERITY_LABEL[finding.policySeverity] ?? finding.policySeverity}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-[var(--dpf-text)]" title={finding.title}>
            {finding.title}
          </p>
          <p className="mt-0.5 truncate text-[var(--dpf-muted)]" title={componentLabel(finding)}>
            {componentLabel(finding)}
            <span className="ml-2 text-[var(--dpf-muted)]">{finding.vendorIdentifier}</span>
          </p>
        </div>
      </div>

      {readOnly ? (
        <p className="text-[var(--dpf-muted)]">
          Status: <span className="font-medium text-[var(--dpf-text)]">{status}</span>
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="text-[var(--dpf-muted)]">Status</span>
            <select
              data-testid="assurance-finding-status-select"
              className="h-7 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 text-xs text-[var(--dpf-text)]"
              value={status}
              disabled={pending}
              onChange={(event) => {
                const next = event.target.value as AssuranceFindingStatus;
                setError(null);
                startTransition(() => {
                  void setAssuranceFindingStatus({ findingKey: finding.findingKey, status: next })
                    .then(() => setStatus(next))
                    .catch((err) => setError(err instanceof Error ? err.message : "update failed"));
                });
              }}
            >
              {STATUS_OPTIONS.map((option) => (
                <option
                  key={option}
                  value={option}
                  className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                >
                  {option}
                </option>
              ))}
            </select>
          </label>
          <button
            data-testid="assurance-finding-create-backlog"
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 text-xs font-medium text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending || Boolean(backlogItemId)}
            onClick={() => {
              setError(null);
              startTransition(() => {
                void requestBacklogFromAssuranceFinding(finding.findingKey)
                  .then((result) => {
                    setBacklogItemId(result.backlogItemId);
                    setStatus("planned");
                  })
                  .catch((err) => setError(err instanceof Error ? err.message : "create failed"));
              });
            }}
          >
            <FilePlus className="h-3.5 w-3.5" aria-hidden="true" />
            {backlogItemId ? `Linked ${backlogItemId}` : "Create backlog"}
          </button>
          {error && (
            <span className="text-[var(--dpf-error)]" role="status">
              {error}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

export function AssuranceFindingsList({
  findings,
  readOnly,
  emptyLabel,
}: {
  findings: ActiveAssuranceFindingRow[];
  readOnly?: boolean;
  emptyLabel?: string;
}) {
  if (findings.length === 0) {
    return (
      <p className="text-xs text-[var(--dpf-muted)]" data-testid="assurance-findings-empty">
        {emptyLabel ?? "No active findings."}
      </p>
    );
  }

  return (
    <ul className="space-y-2" data-testid="assurance-findings-list">
      {findings.map((finding) => (
        <FindingRow key={finding.findingKey} finding={finding} readOnly={readOnly} />
      ))}
    </ul>
  );
}
