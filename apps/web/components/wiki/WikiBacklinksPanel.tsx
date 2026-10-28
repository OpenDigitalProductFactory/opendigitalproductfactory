// BI-4EAFF7AC: the "Linked from" panel on the wiki page viewer.
// Spec: docs/superpowers/specs/2026-10-14-knowledge-linking-design.md §4.2–4.3.
//
// Renders only what `loadWikiBacklinks` returned, which is already limited to
// pages the reader may open (R1). Unlinked mentions start collapsed: they are a
// suggestion list, not part of what the page is.

import type { ReactNode } from "react";

import type { WikiBacklinkRow, WikiBacklinks, WikiBacklinkScope, WikiUnlinkedMention } from "@/lib/wiki/backlinks";

import { BacklinkGroup, type BacklinkItem } from "./BacklinkGroup";

const SCOPE_BADGES: Record<WikiBacklinkScope, string> = {
  "profession-own": "Profession",
  organization: "Organization",
  platform: "Platform",
  profession: "Profession",
};

function linkedFromItem(row: WikiBacklinkRow): BacklinkItem {
  return {
    id: row.id,
    title: row.title,
    href: row.href,
    pageKind: row.pageKind,
    badges: row.via === "kernel-page" ? [SCOPE_BADGES[row.scope], "Links the platform page"] : [SCOPE_BADGES[row.scope]],
    context: row.context,
  };
}

function mentionItem(mention: WikiUnlinkedMention): BacklinkItem {
  return {
    id: mention.id,
    title: mention.title,
    href: mention.href,
    pageKind: mention.pageKind,
    badges: [SCOPE_BADGES[mention.scope]],
    context: mention.context,
    action: mention.linkItHref ? { href: mention.linkItHref, label: "Link it" } : null,
  };
}

export function WikiBacklinksPanel({ backlinks }: { backlinks: WikiBacklinks }): ReactNode {
  const { linkedFrom, linkedFromCount, unlinkedMentions } = backlinks;
  return (
    <section
      aria-labelledby="wiki-backlinks-heading"
      className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-[var(--dpf-text)]"
    >
      <h2 id="wiki-backlinks-heading" className="text-sm font-semibold">
        Linked from
        {linkedFromCount > 0 ? <span className="ml-1 font-normal text-[var(--dpf-muted)]">({linkedFromCount})</span> : null}
      </h2>

      {linkedFromCount === 0 ? (
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">No pages link here yet.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {linkedFrom.map((group) => (
            <BacklinkGroup key={group.scope} label={group.label} items={group.rows.map(linkedFromItem)} />
          ))}
        </div>
      )}

      {unlinkedMentions.length > 0 ? (
        <details className="mt-4 border-t border-[var(--dpf-border)] pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--dpf-muted)]">
            Unlinked mentions ({unlinkedMentions.length})
          </summary>
          <div className="mt-2">
            <BacklinkGroup items={unlinkedMentions.map(mentionItem)} />
          </div>
        </details>
      ) : null}
    </section>
  );
}
