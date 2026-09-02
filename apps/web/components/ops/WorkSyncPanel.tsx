import type { WorkSyncLinkView } from "@/lib/federation/work-sync-read-model";
import { Surface } from "@/components/ui/Surface";
import { StatusBadge } from "@/components/ui/report-kit";

const BADGE: Record<WorkSyncLinkView["healthState"], { intent: "success" | "warning" | "danger" | "info"; label: string }> = {
  "in-step": { intent: "success", label: "In step" },
  behind: { intent: "warning", label: "Behind" },
  broken: { intent: "danger", label: "Broken" },
  "no-peer": { intent: "info", label: "No peer" },
};

/**
 * BI-FF8A57EF / BI-C5456B79 / EP-ZERO-CONFIG-FEDERATION §5.7 — is the backlog
 * in step with the other installations in this organization? One row per
 * trusted same-organization connection, each carrying the same health sentence
 * the cockpit and the MCP briefing show; nothing rendered when there is no
 * such connection, because the question does not arise.
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
          const badge = BADGE[link.healthState];
          return (
            <Surface as="li" key={link.linkId} padding="sm" className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--dpf-text)]">{link.peerLabel}</p>
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">{link.healthLine}</p>
              </div>
              <StatusBadge intent={badge.intent} label={badge.label} variant="soft" />
            </Surface>
          );
        })}
      </ul>
    </Surface>
  );
}
