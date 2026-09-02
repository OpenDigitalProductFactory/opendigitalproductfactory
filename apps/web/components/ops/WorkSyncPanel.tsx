import type { WorkSyncLinkView } from "@/lib/federation/work-sync-read-model";
import { LocalTime } from "@/components/ui/LocalTime";
import { StatusBadge } from "@/components/ui/report-kit";

/**
 * BI-FF8A57EF / BI-C5456B79 — is the backlog in step with the other
 * installations in this organization? One row per trusted same-organization
 * connection; nothing rendered when there is no such connection, because the
 * question does not arise.
 */
export function WorkSyncPanel({ links }: { links: WorkSyncLinkView[] }) {
  if (links.length === 0) return null;
  return (
    <section aria-labelledby="work-sync-heading" className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
      <div className="mb-3">
        <div>
          <h2 id="work-sync-heading" className="text-base font-semibold text-[var(--dpf-text)]">
            Backlog sync with your other installations
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-[var(--dpf-muted)]">
            Every five minutes this installation copies the backlog of each connected installation in your
            organization into its own backlog, and they copy this one. Each item is changed only where it was
            created; the copies follow.
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {links.map((link) => {
          const stuck = link.conflicts > 0;
          const waiting = link.lastSyncedAt === null;
          return (
            <li key={link.linkId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
              <div>
                <p className="text-sm font-semibold text-[var(--dpf-text)]">{link.peerLabel}</p>
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                  {waiting
                    ? "Nothing has arrived from this installation yet. If it stays this way after ten minutes, the other installation needs the latest platform version."
                    : <>{link.mirroredItems} items and {link.mirroredEpics} epics mirrored here · last copied <LocalTime value={link.lastSyncedAt!} mode="datetime" />{link.withdrawn > 0 ? ` · ${link.withdrawn} retired at the source` : ""}</>}
                </p>
                {stuck ? (
                  <p className="mt-1 text-xs text-[var(--dpf-warning)]">
                    {link.conflicts} item{link.conflicts === 1 ? "" : "s"} share an id with work created here and were left alone. Rename or retire the local copy to let the source version through.
                  </p>
                ) : null}
              </div>
              <StatusBadge
                intent={stuck ? "warning" : waiting ? "info" : "success"}
                label={stuck ? "Needs attention" : waiting ? "Waiting for first copy" : "In step"}
                variant="soft"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
