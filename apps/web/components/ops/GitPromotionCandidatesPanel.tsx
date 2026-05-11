import { AlertTriangle, CheckCircle2, Clock3, GitBranch, LoaderCircle, PackageCheck } from "lucide-react";

export type GitPromotionCandidateRow = {
  id: string;
  candidateId: string;
  provider: string;
  repositoryFullName: string;
  branch: string | null;
  afterSha: string | null;
  status: string;
  statusReason: string | null;
  sandboxProviderId: string | null;
  sandboxId: string | null;
  verificationStartedAt: string | null;
  verificationCompletedAt: string | null;
  verificationResult: unknown;
  createdAt: string;
};

type VerificationResult = {
  exitCode?: number;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
};

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  ignored: "Ignored",
  "sandbox-verification-running": "Verifying",
  "sandbox-verification-complete": "Sandbox verified",
  failed: "Failed",
};

function statusIcon(status: string) {
  if (status === "sandbox-verification-complete") return CheckCircle2;
  if (status === "sandbox-verification-running") return LoaderCircle;
  if (status === "failed") return AlertTriangle;
  if (status === "queued") return Clock3;
  return PackageCheck;
}

function statusClass(status: string): string {
  if (status === "sandbox-verification-complete") {
    return "border-[var(--dpf-accent)] text-[var(--dpf-accent)] bg-[var(--dpf-accent)]/10";
  }
  if (status === "failed") {
    return "border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-2)]";
  }
  return "border-[var(--dpf-border)] text-[var(--dpf-muted)] bg-[var(--dpf-surface-2)]";
}

function shortSha(value: string | null): string {
  return value ? value.slice(0, 12) : "unknown";
}

function formatDuration(ms: number | undefined): string | null {
  if (!ms || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function verificationResult(value: unknown): VerificationResult | null {
  if (!value || typeof value !== "object") return null;
  return value as VerificationResult;
}

function evidencePreview(candidate: GitPromotionCandidateRow): string | null {
  const result = verificationResult(candidate.verificationResult);
  const output = [result?.stdout, result?.stderr].filter(Boolean).join("\n").trim();
  if (output) return output.slice(-1200);
  return candidate.statusReason;
}

export function GitPromotionCandidatesPanel({
  candidates,
}: {
  candidates: GitPromotionCandidateRow[];
}) {
  const verifiedCount = candidates.filter((candidate) => candidate.status === "sandbox-verification-complete").length;
  const runningCount = candidates.filter((candidate) => candidate.status === "sandbox-verification-running" || candidate.status === "queued").length;
  const failedCount = candidates.filter((candidate) => candidate.status === "failed").length;

  return (
    <section className="space-y-3" aria-labelledby="git-update-candidates-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="git-update-candidates-heading" className="text-base font-semibold text-[var(--dpf-text)]">
            Git update candidates
          </h2>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Default-branch Git updates that have entered sandbox verification before production promotion review.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2">
            <div className="font-semibold text-[var(--dpf-text)]">{runningCount}</div>
            <div className="text-[var(--dpf-muted)]">Active</div>
          </div>
          <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2">
            <div className="font-semibold text-[var(--dpf-text)]">{verifiedCount}</div>
            <div className="text-[var(--dpf-muted)]">Verified</div>
          </div>
          <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2">
            <div className="font-semibold text-[var(--dpf-text)]">{failedCount}</div>
            <div className="text-[var(--dpf-muted)]">Failed</div>
          </div>
        </div>
      </div>

      {candidates.length === 0 ? (
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5 text-sm text-[var(--dpf-muted)]">
          No Git update candidates yet.
        </div>
      ) : (
        <div className="space-y-3">
          {candidates.map((candidate) => {
            const Icon = statusIcon(candidate.status);
            const result = verificationResult(candidate.verificationResult);
            const duration = formatDuration(result?.durationMs);
            const evidence = evidencePreview(candidate);

            return (
              <article
                key={candidate.id}
                className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium ${statusClass(candidate.status)}`}>
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {STATUS_LABELS[candidate.status] ?? candidate.status}
                      </span>
                      <span className="font-mono text-xs text-[var(--dpf-muted)]">{candidate.candidateId}</span>
                    </div>
                    <div>
                      <div className="truncate text-sm font-semibold text-[var(--dpf-text)]">
                        {candidate.repositoryFullName}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--dpf-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                          {candidate.branch ?? "unknown branch"}
                        </span>
                        <span className="font-mono">{shortSha(candidate.afterSha)}</span>
                        {candidate.sandboxProviderId && <span>{candidate.sandboxProviderId}</span>}
                        {duration && <span>{duration}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-xs text-[var(--dpf-muted)]">
                    <div>{new Date(candidate.createdAt).toLocaleString()}</div>
                    {candidate.sandboxId && <div className="mt-1 font-mono">{candidate.sandboxId}</div>}
                  </div>
                </div>

                {evidence && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
                      Verification evidence
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-[var(--dpf-surface-2)] p-3 text-xs text-[var(--dpf-text)]">
                      {evidence}
                    </pre>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
