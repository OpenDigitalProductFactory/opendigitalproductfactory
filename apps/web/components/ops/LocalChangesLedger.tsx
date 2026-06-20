import type { LocalChangesResult } from "@/lib/self-upgrade/local-changes-ledger";

// Local-changes ledger (EP-1A78BAE1). Shows the changes kept on this system and
// not shared with the community — the install's private delta over upstream.

export function LocalChangesLedger({ result }: { result: LocalChangesResult }) {
  return (
    <section className="rounded-lg border border-[var(--dpf-border)] p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
          Changes kept on your system
        </h3>
        <p className="text-xs text-[var(--dpf-muted)]">
          These changes live only on this system and have not been shared with the community.
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
        <ul className="space-y-1">
          {result.changes.map((c) => (
            <li
              key={c.sha}
              className="flex items-start justify-between gap-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5"
            >
              <span className="text-xs text-[var(--dpf-text)] min-w-0">{c.subject}</span>
              <span className="text-xs text-[var(--dpf-muted)] font-mono shrink-0">
                {c.sha}
                {c.date ? ` · ${c.date.slice(0, 10)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
