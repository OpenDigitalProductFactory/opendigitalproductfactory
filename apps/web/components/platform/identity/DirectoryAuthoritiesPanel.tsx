type DirectoryBranch = {
  dn: string;
  label: string;
  entryCount: number;
  description: string;
};

type PublicationStatus = {
  authorityCount: number;
  aliasCount: number;
  readOnlyConsumers: boolean;
  primaryAuthorityLabel: string;
  upstreamSummary: string;
};

export function DirectoryAuthoritiesPanel({
  baseDn,
  branches,
  publicationStatus,
}: {
  baseDn: string;
  branches: DirectoryBranch[];
  publicationStatus: PublicationStatus;
}) {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Directory</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Define how DPF projects its identity authority into directory-compatible branches without making LDAP the canonical model.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <article className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--dpf-text)]">Projected directory layout</h2>
              <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                The published directory uses stable branches for principal type and groups, while DPF keeps the richer authorization model internally.
              </p>
            </div>
            <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
              Base DN {baseDn}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {branches.map((branch) => (
              <div
                key={branch.dn}
                className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--dpf-text)]">{branch.label}</p>
                    <p className="mt-1 text-[11px] font-mono text-[var(--dpf-muted)]">{branch.dn}</p>
                    <p className="mt-2 text-sm text-[var(--dpf-muted)]">{branch.description}</p>
                  </div>
                  <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[11px] text-[var(--dpf-text)]">
                    {branch.entryCount} entries
                  </span>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="space-y-4">
          <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">Publication posture</h2>
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">
              External directory consumers should bind, search, and read. DPF stays the write authority for routes, groups, coworker trust, and local policy.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Authorities</p>
                <p className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">{publicationStatus.authorityCount}</p>
              </div>
              <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Aliases</p>
                <p className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">{publicationStatus.aliasCount}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span
                className={[
                  "rounded-full border px-2 py-1 text-[11px] font-medium",
                  publicationStatus.readOnlyConsumers
                    ? "border-[var(--dpf-success)] bg-[var(--dpf-success)]/10 text-[var(--dpf-success)]"
                    : "border-[var(--dpf-warning)] bg-[var(--dpf-warning)]/10 text-[var(--dpf-warning)]",
                ].join(" ")}
              >
                {publicationStatus.readOnlyConsumers ? "Read-only" : "Writable"}
              </span>
              <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[11px] text-[var(--dpf-text)]">
                {publicationStatus.primaryAuthorityLabel}
              </span>
            </div>
            <p className="mt-4 text-sm text-[var(--dpf-muted)]">{publicationStatus.upstreamSummary}</p>
          </div>

          <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">Projection rules</h2>
            <div className="mt-3 space-y-2 text-sm text-[var(--dpf-muted)]">
              <p>People, agents, services, and groups live in separate published branches.</p>
              <p>Roles are projected as groups for LDAP compatibility.</p>
              <p>AI coworkers remain distinguishable through both branch placement and explicit type attributes.</p>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
