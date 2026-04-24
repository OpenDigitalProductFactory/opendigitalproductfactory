type ProtocolProfile = {
  protocol: "oidc" | "saml" | "ldap-only";
  label: string;
  readiness: "ready" | "planned";
  description: string;
  contractFields: string[];
};

type PublicationMetrics = {
  authorityCount: number;
  aliasCount: number;
  roleAssignmentCount: number;
  businessGroupCount: number;
  provisioningSummary: string;
  connectionSummary: string;
};

export function ApplicationAssignmentsPanel({
  protocolProfiles,
  publicationMetrics,
}: {
  protocolProfiles: ProtocolProfile[];
  publicationMetrics: PublicationMetrics;
}) {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Applications</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Map relying parties, external products, and future SCIM or LDAP consumers onto DPF-owned identity state.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_1fr]">
        <article className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--dpf-text)]">Protocol readiness</h2>
              <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                The identity edge will publish DPF authority to downstream applications through standard federation profiles rather than one-off app auth.
              </p>
            </div>
            <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
              {publicationMetrics.authorityCount} authorities
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {protocolProfiles.map((profile) => (
              <div
                key={profile.protocol}
                className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--dpf-text)]">{profile.label}</p>
                    <p className="mt-2 text-sm text-[var(--dpf-muted)]">{profile.description}</p>
                  </div>
                  <span
                    className={[
                      "rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.14em]",
                      profile.readiness === "ready"
                        ? "border-[var(--dpf-success)] bg-[var(--dpf-success)]/10 text-[var(--dpf-success)]"
                        : "border-[var(--dpf-warning)] bg-[var(--dpf-warning)]/10 text-[var(--dpf-warning)]",
                    ].join(" ")}
                  >
                    {profile.readiness}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {profile.contractFields.map((field) => (
                    <span
                      key={`${profile.protocol}-${field}`}
                      className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[11px] text-[var(--dpf-text)]"
                    >
                      {field}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="space-y-4">
          <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">Downstream contract</h2>
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">
              Per the design, DPF should eventually maintain an application registry with protocol, claim mappings, assigned groups, and provisioning mode for each relying party.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Aliases</p>
                <p className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">{publicationMetrics.aliasCount}</p>
              </div>
              <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Role links</p>
                <p className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">{publicationMetrics.roleAssignmentCount}</p>
              </div>
              <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Business groups</p>
                <p className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">{publicationMetrics.businessGroupCount}</p>
              </div>
              <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
                <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Provisioning</p>
                <p className="mt-2 text-sm font-semibold text-[var(--dpf-text)]">{publicationMetrics.provisioningSummary}</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-[var(--dpf-muted)]">{publicationMetrics.connectionSummary}</p>
          </div>

          <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">Next registry fields</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {["protocol", "claim mappings", "assigned groups", "provisioning mode", "status"].map((field) => (
                <span
                  key={field}
                  className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[11px] text-[var(--dpf-text)]"
                >
                  {field}
                </span>
              ))}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
