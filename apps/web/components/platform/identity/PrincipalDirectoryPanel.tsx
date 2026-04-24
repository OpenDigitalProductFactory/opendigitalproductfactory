type PrincipalRow = {
  id: string;
  principalId: string;
  kind: string;
  status: string;
  displayName: string;
  aliases: Array<{
    aliasType: string;
    aliasValue: string;
    issuer: string;
  }>;
};

export function PrincipalDirectoryPanel({ principals }: { principals: PrincipalRow[] }) {
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Principals</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Review the shared identity inventory for humans, AI coworkers, and future service identities.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {principals.map((principal) => (
          <article
            key={principal.id}
            className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-mono text-[var(--dpf-muted)]">{principal.principalId}</p>
                <h2 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">
                  {principal.displayName}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
                  {principal.kind}
                </span>
                <span className="rounded-full border border-[var(--dpf-border)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-text)]">
                  {principal.status}
                </span>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
                Aliases
              </p>
              <div className="flex flex-wrap gap-2">
                {principal.aliases.map((alias) => (
                  <span
                    key={`${alias.aliasType}-${alias.aliasValue}`}
                    className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[11px] text-[var(--dpf-text)]"
                  >
                    <span className="text-[var(--dpf-muted)]">{alias.aliasType}</span>
                    {" "}
                    {alias.aliasValue}
                  </span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
