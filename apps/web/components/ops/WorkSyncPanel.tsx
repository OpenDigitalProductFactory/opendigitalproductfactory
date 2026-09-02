import type { WorkSyncLinkView } from "@/lib/federation/work-sync-read-model";
import { LocalTime } from "@/components/ui/LocalTime";
import { Surface } from "@/components/ui/Surface";
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
    <Surface as="section" level={2} rounded="xl" aria-labelledby="work-sync-heading">
      <h2 id="work-sync-heading" className="text-base font-semibold text-[var(--dpf-text)]">
        Backlog sync with your other installations
      </h2>
      <p className="mt-1 max-w-3xl text-xs text-[var(--dpf-muted)]">
        Every five minutes, each connected installation in your organization copies the others&apos; backlogs.
        An item changes only where it was created; the copies follow.
      </p>
      <ul className="mt-3 space-y-2">
        {links.map((link) => {
          const stuck = link.conflicts > 0;
          const waiting = link.lastSyncedAt === null;
          return (
            <Surface as="li" key={link.linkId} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--dpf-text)]">{link.peerLabel}</p>
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                  {waiting
                    ? "Nothing has arrived yet. After ten minutes, that means the other installation needs the latest platform version."
                    : <>{link.mirroredItems} items and {link.mirroredEpics} epics copied here · last copy <LocalTime value={link.lastSyncedAt!} mode="datetime" />{link.withdrawn > 0 ? ` · ${link.withdrawn} retired at the source` : ""}</>}
                </p>
                {stuck ? (
                  <p className="mt-1 text-xs text-[var(--dpf-warning)]">
                    {link.conflicts} item{link.conflicts === 1 ? "" : "s"} share an id with local work and were left alone.
                  </p>
                ) : null}
              </div>
              <StatusBadge
                intent={stuck ? "warning" : waiting ? "info" : "success"}
                label={stuck ? "Needs attention" : waiting ? "Waiting for first copy" : "In step"}
                variant="soft"
              />
            </Surface>
          );
        })}
      </ul>
    </Surface>
  );
}
