// BI-BB13B599 (EP-WORK-CONVERGENCE): the plain, business-safe customer-mode
// status band. Reads the capsule-derived projection (projectBuildStudioCustomerStatus)
// so external Claude/Codex/Grok work carried on the WorkCapsule is reflected in
// one plain lifecycle line — never a raw phase, never an executor name. This is
// the first-viewport "wife-test" status: what is being built, where it is, and
// whether it needs the operator.
import type { BuildStudioCustomerStatus } from "@/lib/build/customer-status-projection";

const NEEDS_YOU_PILL =
  "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none " +
  "border-[var(--dpf-warning)] bg-[var(--dpf-state-warning)] text-[var(--dpf-warning)]";

export function BuildCustomerStatusBand({ status }: { status: BuildStudioCustomerStatus }) {
  return (
    <div
      className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3"
      data-testid="build-customer-status-band"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[11px] font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Status</p>
          <p className="m-0 mt-0.5 text-sm font-semibold text-[var(--dpf-text)]">{status.lifecyclePosition}</p>
          <p className="m-0 mt-0.5 text-xs text-[var(--dpf-muted)]">{status.worker}</p>
          <p className="m-0 mt-1 text-[11px] leading-relaxed text-[var(--dpf-muted)]">
            Evidence: {status.evidence}
          </p>
          <p className="m-0 mt-0.5 text-[11px] leading-relaxed text-[var(--dpf-text)]">
            Next action: {status.nextAction}
          </p>
          <p className="m-0 mt-0.5 text-[11px] leading-relaxed text-[var(--dpf-muted)]">
            Owner: {status.owner}
          </p>
          {status.technicalEvidence && (
            <details className="mt-1 text-[11px] text-[var(--dpf-muted)]">
              <summary className="cursor-pointer text-[var(--dpf-accent)]">Technical delivery details</summary>
              <p className="m-0 mt-1 font-mono leading-relaxed">{status.technicalEvidence}</p>
            </details>
          )}
        </div>
        {status.needsYou && (
          <span className={NEEDS_YOU_PILL} data-testid="build-customer-status-needs-you">
            Needs you
          </span>
        )}
      </div>
    </div>
  );
}
