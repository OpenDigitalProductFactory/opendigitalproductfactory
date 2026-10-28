// BI-4EAFF7AC: the "Linked from" panel on the wiki page viewer.
// Spec: docs/superpowers/specs/2026-10-14-knowledge-linking-design.md §4.2–4.3.
//
// Renders only what `loadWikiBacklinks` returned, which is already limited to
// pages the reader may open (R1). Unlinked mentions start collapsed: they are a
// suggestion list, not part of what the page is.

import type { ReactNode } from "react";

import { Surface } from "@/components/ui/Surface";
import type { WikiBacklinkRow, WikiBacklinks, WikiBacklinkScope, WikiUnlinkedMention } from "@/lib/wiki/backlinks";

import { BacklinkGroup, type BacklinkItem } from "./BacklinkGroup";

/** The panel's copy, resolved from the `wiki` message catalog by the route. */
export type WikiBacklinksLabels = {
  heading: string;
  empty: string;
  unlinkedMentions: string;
  linkIt: string;
  linksPlatformPage: string;
  groups: Record<WikiBacklinkScope, string>;
  scopes: Record<WikiBacklinkScope, string>;
};

function linkedFromItem(row: WikiBacklinkRow, labels: WikiBacklinksLabels): BacklinkItem {
  const scope = labels.scopes[row.scope];
  return {
    id: row.id,
    title: row.title,
    href: row.href,
    pageKind: row.pageKind,
    badges: row.via === "kernel-page" ? [scope, labels.linksPlatformPage] : [scope],
    context: row.context,
  };
}

function mentionItem(mention: WikiUnlinkedMention, labels: WikiBacklinksLabels): BacklinkItem {
  return {
    id: mention.id,
    title: mention.title,
    href: mention.href,
    pageKind: mention.pageKind,
    badges: [labels.scopes[mention.scope]],
    context: mention.context,
    action: mention.linkItHref ? { href: mention.linkItHref, label: labels.linkIt } : null,
  };
}

export function WikiBacklinksPanel({
  backlinks,
  labels,
}: {
  backlinks: WikiBacklinks;
  labels: WikiBacklinksLabels;
}): ReactNode {
  const { linkedFrom, linkedFromCount, unlinkedMentions } = backlinks;
  return (
    <Surface as="section" aria-labelledby="wiki-backlinks-heading" className="text-[var(--dpf-text)]">
      <h2 id="wiki-backlinks-heading" className="text-sm font-semibold">
        {labels.heading}
        {linkedFromCount > 0 ? <span className="ms-1 font-normal text-[var(--dpf-muted)]">({linkedFromCount})</span> : null}
      </h2>

      {linkedFromCount === 0 ? (
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">{labels.empty}</p>
      ) : (
        <div className="mt-3 space-y-4">
          {linkedFrom.map((group) => (
            <BacklinkGroup
              key={group.scope}
              label={labels.groups[group.scope]}
              items={group.rows.map((row) => linkedFromItem(row, labels))}
            />
          ))}
        </div>
      )}

      {unlinkedMentions.length > 0 ? (
        <details className="mt-4 border-t border-[var(--dpf-border)] pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--dpf-muted)]">
            {labels.unlinkedMentions}
          </summary>
          <div className="mt-2">
            <BacklinkGroup items={unlinkedMentions.map((mention) => mentionItem(mention, labels))} />
          </div>
        </details>
      ) : null}
    </Surface>
  );
}
