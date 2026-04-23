import type {
  BuildDeliberationPhase,
  BuildDeliberationSummaryEntry,
} from "@/lib/feature-build-types";

type Props = {
  phase: BuildDeliberationPhase;
  summary: BuildDeliberationSummaryEntry;
};

const PHASE_LABELS: Record<BuildDeliberationPhase, string> = {
  ideate: "Ideate",
  plan: "Plan",
  review: "Review",
};

export function DeliberationSummaryCard({ phase, summary }: Props) {
  const unresolved = summary.unresolvedRisks ?? [];

  return (
    <section
      data-testid={`deliberation-summary-${phase}`}
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 shadow-dpf-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">
            {PHASE_LABELS[phase]} Deliberation
          </div>
          <div className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
            {summary.patternSlug === "debate" ? "Debate" : "Peer Review"}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge>{summary.evidenceQuality}</Badge>
          <Badge>{summary.diversityLabel}</Badge>
          <Badge>{summary.consensusState}</Badge>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-[var(--dpf-text)]">
        {summary.rationaleSummary}
      </p>

      {unresolved.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">
            Unresolved Risks
          </div>
          <ul className="mt-1 list-disc pl-5 text-xs leading-relaxed text-[var(--dpf-text)]">
            {unresolved.map((risk, index) => (
              <li key={`${phase}-${index}`}>{risk}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--dpf-muted)]">
      {children}
    </span>
  );
}
