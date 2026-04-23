type ClaimItem = {
  claimId: string;
  claimType: string;
  claimText: string;
  evidenceGrade: string;
  status: string;
};

type EvidenceItem = {
  bundleId: string;
  summary: string;
  sourceCount: number;
};

type Props = {
  title: string;
  adjudicationNotes?: string | null;
  claims: ClaimItem[];
  evidenceBundles: EvidenceItem[];
};

export function DeliberationDrilldown({
  title,
  adjudicationNotes,
  claims,
  evidenceBundles,
}: Props) {
  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3 shadow-dpf-xs">
      <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{title}</h3>

      {adjudicationNotes && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--dpf-muted)]">
          {adjudicationNotes}
        </p>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">
            Claims
          </div>
          <ul className="mt-2 space-y-2">
            {claims.map((claim) => (
              <li
                key={claim.claimId}
                className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2"
              >
                <div className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">
                  {claim.claimType} · Grade {claim.evidenceGrade} · {claim.status}
                </div>
                <div className="mt-1 text-xs text-[var(--dpf-text)]">
                  {claim.claimText}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">
            Evidence Bundles
          </div>
          <ul className="mt-2 space-y-2">
            {evidenceBundles.map((bundle) => (
              <li
                key={bundle.bundleId}
                className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-xs text-[var(--dpf-text)]"
              >
                <div>{bundle.summary}</div>
                <div className="mt-1 text-[var(--dpf-muted)]">
                  {bundle.sourceCount} source{bundle.sourceCount === 1 ? "" : "s"}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
