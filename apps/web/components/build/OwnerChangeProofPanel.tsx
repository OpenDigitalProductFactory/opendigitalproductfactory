import { Eye, FileCheck2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import type { BuildDecisionLedgerEntry } from "@/lib/build/decision-ledger";
import type { BuildChangeNarrative } from "@/lib/feature-build-types";
import { hasReadableProof } from "@/lib/build/owner-change-view";
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
          <Button
            type="button"
            variant="secondary"
            onClick={onOpenBrief}
            className="min-h-11 gap-2"
          >
            <Pencil size={15} aria-hidden="true" />
            Review outcome
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onOpenProof}
            className="min-h-11 gap-2"
          >
            <FileCheck2 size={15} aria-hidden="true" />
            Review proof
          </Button>
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

        {/* Early in a build every check reads "not applicable" / "not recorded".
            Three cards saying "nothing yet" cost attention and return none; the
            checks still run and appear as soon as any has an answer. */}
        <div className="grid gap-2" aria-label="Recorded proof">
          {(hasReadableProof(view.proof) ? view.proof.checks : []).map((check) => (
            <Surface
              as="article"
              key={check.key}
              level={1}
              padding="sm"
              rounded="xl"
              className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
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
            </Surface>
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
