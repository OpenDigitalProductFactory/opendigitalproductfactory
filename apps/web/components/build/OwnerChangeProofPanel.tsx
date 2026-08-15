import { Eye, FileCheck2, Pencil } from "lucide-react";
import { StatusBadge } from "@/components/ui/report-kit";
import type { BuildDecisionLedgerEntry } from "@/lib/build/decision-ledger";
import type { BuildChangeNarrative } from "@/lib/feature-build-types";
import type { OwnerChangeView, OwnerProofState } from "@/lib/build/owner-change-view";
import { BuildChangeSummaryBand } from "./BuildChangeSummaryBand";
import { BuildDecisionLedgerBand } from "./BuildDecisionLedgerBand";

const PROOF_LABEL: Record<OwnerProofState, string> = {
  passed: "Passed",
  failed: "Failed",
  "not-applicable": "Not applicable",
  "not-recorded": "Not recorded",
  stale: "Stale",
};

export function OwnerChangeProofPanel({
  view,
  previewUrl,
  changeNarrative = null,
  decisionLedger = [],
  onOpenBrief,
  onOpenProof,
}: {
  view: OwnerChangeView;
  previewUrl: string | null;
  changeNarrative?: BuildChangeNarrative | null;
  decisionLedger?: readonly BuildDecisionLedgerEntry[];
  onOpenBrief: () => void;
  onOpenProof: () => void;
}) {
  const previewSummary = !view.preview.available
    ? "Preview will appear when there is a working version to inspect."
    : view.preview.drivingThisChange
      ? "A live preview of this Change is ready."
      : "The shared preview is currently showing another Change.";

  return (
    <section
      data-testid="owner-change-proof"
      aria-labelledby="owner-change-proof-heading"
      className="border-t border-[var(--dpf-border)] px-5 py-5 sm:px-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 text-dpf-caption font-semibold uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
            Preview and proof
          </p>
          <h3 id="owner-change-proof-heading" className="m-0 mt-1 text-lg font-semibold text-[var(--dpf-text)]">
            See what changed and what has been checked
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenBrief}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 text-sm font-semibold text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            <Pencil size={15} aria-hidden="true" />
            Review outcome
          </button>
          <button
            type="button"
            onClick={onOpenProof}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[var(--dpf-accent)] px-3 text-sm font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            <FileCheck2 size={15} aria-hidden="true" />
            Review proof
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <article className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
          {view.proof.whatChanged ? (
            <div className="mb-4 border-b border-[var(--dpf-border)] pb-4">
              <p className="m-0 text-dpf-caption font-semibold uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
                What changed
              </p>
              <p className="m-0 mt-1 text-sm leading-5 text-[var(--dpf-text)]">{view.proof.whatChanged}</p>
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--dpf-text)]">
            <Eye size={16} className="text-[var(--dpf-accent)]" aria-hidden="true" />
            Live preview
          </div>
          <p className="m-0 mt-2 text-sm leading-5 text-[var(--dpf-muted)]">{previewSummary}</p>
          {view.preview.drivingThisChange && previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--dpf-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
            >
              Open live preview
            </a>
          ) : null}
          {view.proof.openRisks.length > 0 ? (
            <div className="mt-4 border-t border-[var(--dpf-border)] pt-4">
              <p className="m-0 text-dpf-caption font-semibold uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
                Open questions
              </p>
              <p className="m-0 mt-1 text-xs leading-5 text-[var(--dpf-warning)]">
                {view.proof.openRisks.join(" ")}
              </p>
            </div>
          ) : null}
        </article>

        <div className="grid gap-2" aria-label="Recorded proof">
          {view.proof.checks.map((check) => (
            <article
              key={check.key}
              className="flex flex-col gap-2 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <p className="m-0 text-sm font-semibold text-[var(--dpf-text)]">{check.label}</p>
                <p className="m-0 mt-1 text-xs leading-5 text-[var(--dpf-muted)]">{check.summary}</p>
              </div>
              <StatusBadge
                domain="ownerProof"
                status={check.state}
                label={PROOF_LABEL[check.state]}
                variant="soft"
                uppercase={false}
                className="shrink-0"
              />
            </article>
          ))}
        </div>
      </div>

      {changeNarrative || decisionLedger.length > 0 ? (
        <div
          data-testid="owner-proof-supporting-context"
          className="mt-4 grid gap-3 lg:grid-cols-2"
        >
          {changeNarrative ? <BuildChangeSummaryBand narrative={changeNarrative} /> : null}
          {decisionLedger.length > 0 ? <BuildDecisionLedgerBand entries={decisionLedger} /> : null}
        </div>
      ) : null}
    </section>
  );
}
