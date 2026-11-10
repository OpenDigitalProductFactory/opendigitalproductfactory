import { Surface } from "@/components/ui/Surface";

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

/**
 * What the install is actually serving (EP-24741BBF · BI-A91004A7). The three
 * states are rendered distinctly on purpose: a directory that was turned on and
 * failed must not read the same as one nobody asked for.
 */
type ListenerStatus =
  | { state: "disabled"; detail: string }
  | { state: "listening"; port: number; detail: string }
  | { state: "refused"; reason: string; detail: string };

const LISTENER_PRESENTATION: Record<
  ListenerStatus["state"],
  { label: string; tone: "muted" | "success" | "warning" }
> = {
  disabled: { label: "Not served", tone: "muted" },
  listening: { label: "Serving LDAPS", tone: "success" },
  refused: { label: "Failed to start", tone: "warning" },
};

function ListenerCard({ listener }: { listener: ListenerStatus }) {
  const { label, tone } = LISTENER_PRESENTATION[listener.state];
  const toneClass =
    tone === "success"
      ? "border-[var(--dpf-success)] bg-[var(--dpf-success)]/10 text-[var(--dpf-success)]"
      : tone === "warning"
        ? "border-[var(--dpf-warning)] bg-[var(--dpf-warning)]/10 text-[var(--dpf-warning)]"
        : "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]";

  return (
    <Surface rounded="xl" padding="lg">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-dpf-body-lg font-semibold text-[var(--dpf-text)]">Directory listener</h2>
        <span className={`rounded-full border px-2 py-1 text-dpf-caption font-medium ${toneClass}`}>
          {label}
        </span>
      </div>

      {listener.state === "listening" && (
        <p className="mt-3 text-dpf-caption font-mono text-[var(--dpf-text)]">port {listener.port}</p>
      )}
      {listener.state === "refused" && (
        <p className="mt-3 text-dpf-body text-[var(--dpf-warning)]">{listener.reason}</p>
      )}
      <p className="mt-3 text-dpf-body text-[var(--dpf-muted)]">{listener.detail}</p>
    </Surface>
  );
}

export function DirectoryAuthoritiesPanel({
  baseDn,
  branches,
  publicationStatus,
  listener,
}: {
  baseDn: string;
  branches: DirectoryBranch[];
  publicationStatus: PublicationStatus;
  listener: ListenerStatus;
}) {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Directory</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          How DPF shares who works here as a directory, without letting LDAP own the model.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <article className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--dpf-text)]">How the tree is laid out</h2>
              <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                Fixed branches by kind of user and by group. The fuller access rules stay inside DPF.
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
          <ListenerCard listener={listener} />

          <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">What we publish</h2>
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">
              Others bind, search, and read. Only DPF writes.
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
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">House rules</h2>
            <div className="mt-3 space-y-2 text-sm text-[var(--dpf-muted)]">
              <p>People, agents, services, and groups each get their own branch.</p>
              <p>Roles show up as groups, so LDAP tools work.</p>
              <p>You can still tell AI coworkers apart, by branch and by type.</p>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
