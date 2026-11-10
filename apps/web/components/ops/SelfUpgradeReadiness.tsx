import { serviceReconcileFromEvidence } from "@/lib/self-upgrade/service-reconcile-outcome";

type ReadinessSummary = {
  owner: string;
  mode: string;
  result: string;
  contractVersion: number | null;
  contractDigest: string | null;
  failures: Record<string, unknown>[];
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function summarizeReadiness(completionEvidence: unknown): ReadinessSummary | null {
  const evidence = record(completionEvidence);
  const readiness = record(evidence?.readiness);
  if (!readiness || readiness.stage !== "preflight") return null;
  return {
    owner: String(readiness.owner ?? "unavailable"),
    mode: String(readiness.mode ?? "legacy-bootstrap"),
    result: String(readiness.result ?? "unavailable"),
    contractVersion: typeof readiness.contractVersion === "number" ? readiness.contractVersion : null,
    contractDigest: typeof readiness.contractDigest === "string" ? readiness.contractDigest : null,
    failures: Array.isArray(readiness.failures)
      ? readiness.failures.map(record).filter((failure): failure is Record<string, unknown> => failure !== null)
      : [],
  };
}

/**
 * BI-DB87D925: the portal swap landed, but a service this install requires could
 * not be created (for example, its image tag is no longer published). Say so
 * instead of leaving a plain green run.
 */
export function SelfUpgradeServiceReconcileNotice({ completionEvidence }: { completionEvidence: unknown }) {
  const reconcile = serviceReconcileFromEvidence(completionEvidence);
  if (reconcile?.outcome !== "degraded") return null;
  const count = reconcile.failed.length;
  return (
    <div
      className="mt-3 rounded-lg border border-[var(--dpf-warning)]/40 bg-[var(--dpf-warning)]/15 p-3 text-xs"
      data-service-reconcile="degraded"
    >
      <div className="font-medium text-[var(--dpf-warning)]">
        Degraded — {count} required service{count === 1 ? "" : "s"} could not be started
      </div>
      <div className="mt-1 text-[var(--dpf-muted)]">
        The upgrade itself completed. Not running: {reconcile.failed.join(", ")}.
        {reconcile.created.length > 0 && ` Started this time: ${reconcile.created.join(", ")}.`} The next upgrade
        tries again.
      </div>
    </div>
  );
}

export function SelfUpgradeReadiness({ completionEvidence }: { completionEvidence: unknown }) {
  const readiness = summarizeReadiness(completionEvidence);
  const notice = <SelfUpgradeServiceReconcileNotice completionEvidence={completionEvidence} />;
  if (!readiness) return notice;
  return (
    <>
    {notice}
    <div
      className="mt-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-xs"
      data-readiness-result={readiness.result}
      data-readiness-owner={readiness.owner}
    >
      <div className="font-medium text-[var(--dpf-text)]">
        {readiness.mode === "legacy-bootstrap"
          ? "Legacy bootstrap — pre-drain readiness was unavailable"
          : `Pre-drain readiness: ${readiness.result}`}
      </div>
      <div className="mt-1 text-[var(--dpf-muted)]">
        Validation owner: {readiness.owner}
        {readiness.contractVersion != null ? ` · contract v${readiness.contractVersion}` : ""}
        {readiness.contractDigest ? ` · ${readiness.contractDigest.slice(0, 15)}…` : ""}
      </div>
      {readiness.failures.map((failure, index) => (
        <div key={index} className="mt-1 text-[var(--dpf-destructive)]">
          {String(failure.message ?? failure.code ?? "Readiness check failed")}
          {failure.remediation ? ` — ${String(failure.remediation)}` : ""}
        </div>
      ))}
    </div>
    </>
  );
}
