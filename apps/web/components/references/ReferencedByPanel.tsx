// BI-A63A9476: the "Referenced by" section (spec 2026-10-14 §5, "Read surfaces").
//
// Renders only what the shared reader returned (lib/references/read-references.ts),
// which is already limited to what the reader may open (R1): an unreadable
// source is absent, not counted and never hinted at. Server-usable: no hooks;
// the caller resolves the copy from the `references` catalog.

import type { ReactNode } from "react";

import { Surface } from "@/components/ui/Surface";
import { BacklinkGroup } from "@/components/wiki/BacklinkGroup";
import type { ReferenceRow } from "@/lib/references/read-references";

export type ReferencedByLabels = {
  heading: string;
  empty: string;
  kinds: Record<ReferenceRow["kind"], string>;
  scopes: Record<ReferenceRow["scope"], string>;
};

type Translate = (key: never) => string;

/** The panel copy from a `references` translator (server getT or client useT). */
export function referencedByLabels(t: (key: string) => string): ReferencedByLabels {
  const k = (key: string) => (t as Translate)(key as never);
  return {
    heading: k("referencedBy.heading"),
    empty: k("referencedBy.empty"),
    kinds: {
      wiki: k("referencedBy.kinds.wiki"),
      backlog: k("referencedBy.kinds.backlog"),
      epic: k("referencedBy.kinds.epic"),
      document: k("referencedBy.kinds.document"),
      workroom: k("referencedBy.kinds.workroom"),
      message: k("referencedBy.kinds.message"),
    },
    scopes: {
      kernel: k("referencedBy.scopes.kernel"),
      profession: k("referencedBy.scopes.profession"),
      organization: k("referencedBy.scopes.organization"),
      install: k("referencedBy.scopes.install"),
    },
  };
}

export function ReferencedByPanel({
  rows,
  labels,
  headingId = "referenced-by-heading",
  level = 1,
}: {
  rows: ReferenceRow[];
  labels: ReferencedByLabels;
  headingId?: string;
  level?: 1 | 2;
}): ReactNode {
  return (
    <Surface as="section" level={level} aria-labelledby={headingId} className="text-[var(--dpf-text)]">
      <h2 id={headingId} className="text-sm font-semibold">
        {labels.heading}
        {rows.length > 0 ? <span className="ms-1 font-normal text-[var(--dpf-muted)]">({rows.length})</span> : null}
      </h2>
      <div className="mt-2">
        <BacklinkGroup
          emptyLabel={labels.empty}
          items={rows.map((row) => ({
            id: `${row.kind}:${row.key}`,
            title: row.title,
            href: row.href,
            badges: [labels.kinds[row.kind], labels.scopes[row.scope], ...(row.status ? [row.status] : [])],
            context: row.snippet,
          }))}
        />
      </div>
    </Surface>
  );
}
