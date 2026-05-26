"use client";

type EnvironmentCandidateStatus = "available" | "pending" | "blocked";
type LocalIntegrationStatus = "passed" | "pending" | "failed" | "blocked";

export type EnvironmentStatusSummaryProps = {
  activeCandidate: {
    status: EnvironmentCandidateStatus;
    url?: string | null;
    summary?: string | null;
  };
  localIntegration: {
    status: LocalIntegrationStatus;
    summary?: string | null;
  };
};

const ENVIRONMENT_LABELS: Record<EnvironmentCandidateStatus, string> = {
  available: "Shared environment ready",
  pending: "Shared environment pending",
  blocked: "Shared environment blocked",
};

const INTEGRATION_LABELS: Record<LocalIntegrationStatus, string> = {
  passed: "Merged-code check passed",
  pending: "Merged-code check pending",
  failed: "Merged-code check failed",
  blocked: "Merged-code check blocked",
};

const STATUS_CLASSES: Record<EnvironmentCandidateStatus | LocalIntegrationStatus, string> = {
  available: "text-[var(--dpf-success)]",
  passed: "text-[var(--dpf-success)]",
  pending: "text-[var(--dpf-warning)]",
  blocked: "text-[var(--dpf-error)]",
  failed: "text-[var(--dpf-error)]",
};

export function EnvironmentStatusSummary({ activeCandidate, localIntegration }: EnvironmentStatusSummaryProps) {
  return (
    <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase text-[var(--dpf-text)]">
          Environment readiness
        </h3>
        {activeCandidate.url && (
          <a
            href={activeCandidate.url}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-[var(--dpf-border)] px-2 py-1 text-[10px] font-semibold text-[var(--dpf-accent)] transition hover:bg-[var(--dpf-surface-2)]"
          >
            Open environment
          </a>
        )}
      </div>

      <div className="mt-3 space-y-2">
        <StatusRow
          label={ENVIRONMENT_LABELS[activeCandidate.status]}
          status={activeCandidate.status}
          summary={activeCandidate.summary ?? "Use the shared preview environment for validation."}
        />
        <StatusRow
          label={INTEGRATION_LABELS[localIntegration.status]}
          status={localIntegration.status}
          summary={localIntegration.summary ?? "Run the merged-code check before release decisions."}
        />
      </div>
    </section>
  );
}

function StatusRow({
  label,
  status,
  summary,
}: {
  label: string;
  status: EnvironmentCandidateStatus | LocalIntegrationStatus;
  summary: string;
}) {
  return (
    <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-2">
      <div className="flex items-center gap-2">
        <span className={`text-xs font-semibold ${STATUS_CLASSES[status]}`}>{label}</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--dpf-muted)]">{sanitizeOperatorSummary(summary)}</p>
    </div>
  );
}

function sanitizeOperatorSummary(summary: string): string {
  return summary
    .replace(/\bMCP\b/gi, "platform")
    .replace(/\blease\b/gi, "assignment")
    .replace(/\blocalhost:\d+\b/gi, "shared preview")
    .replace(/\bdpf-[a-z0-9-]+\b/gi, "platform skill")
    .replace(/\bprinciple_decide\b/gi, "decision service");
}
