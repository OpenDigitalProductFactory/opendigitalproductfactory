import type { LocalChangesResult } from "@/lib/self-upgrade/local-changes-ledger";

// Local-changes ledger (EP-1A78BAE1). Shows the files whose content differs on
// this system from the community version — the install's private delta over
// upstream, measured by content (not commit identity, which squash-merges
// destroy). See local-changes-ledger.ts for the three-dot-diff rationale.

export function LocalChangesLedger({ result }: { result: LocalChangesResult }) {
  const totalAdded = result.changes.reduce((sum, c) => sum + c.added, 0);
  const totalDeleted = result.changes.reduce((sum, c) => sum + c.deleted, 0);

  return (
    <section className="rounded-lg border border-[var(--dpf-border)] p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
          Changes kept on your system
        </h3>
        <p className="text-xs text-[var(--dpf-muted)]">
          These files differ from the community version and have not been shared upstream.
          Shared changes flow upstream and come back through updates, so anything listed here is
          your private work.
        </p>
      </div>

      {!result.available ? (
        <p className="text-xs text-[var(--dpf-muted)]">{result.note ?? "No local-changes list available."}</p>
      ) : result.changes.length === 0 ? (
        <p className="text-xs text-[var(--dpf-muted)]">
          Nothing kept private — everything on this system matches the community version.
        </p>
      ) : (
        <>
          <p className="text-xs text-[var(--dpf-muted)] font-mono">
            {result.changes.length} file{result.changes.length === 1 ? "" : "s"} ·{" "}
            <span className="text-[var(--dpf-accent)]">+{totalAdded}</span> ·{" "}
            <span className="text-[var(--dpf-text)]">−{totalDeleted}</span>
          </p>
          <ul className="space-y-1">
            {result.changes.map((c) => (
              <li
                key={c.path}
                className="flex items-start justify-between gap-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5"
              >
                <span className="text-xs text-[var(--dpf-text)] font-mono min-w-0 truncate" title={c.path}>
                  {c.path}
                </span>
                <span className="text-xs font-mono shrink-0 whitespace-nowrap">
                  <span className="text-[var(--dpf-accent)]">+{c.added}</span>{" "}
                  <span className="text-[var(--dpf-muted)]">−{c.deleted}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
