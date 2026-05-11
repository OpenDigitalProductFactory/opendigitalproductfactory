// EP-WIKI-001 Phase 6a: list view of wiki pages with simple grouping.
// Server component. Pages are passed in already filtered + sorted.

import Link from "next/link";
import type { ReactNode } from "react";

import { WikiPageKindBadge } from "./WikiPageKindBadge";

export type WikiPageListItem = {
  id: string;
  slug: string;
  title: string;
  pageKind: string;
  status: string;
  isKernel: boolean;
  abstract: string | null;
};

type Props = {
  pages: WikiPageListItem[];
};

const KIND_ORDER = [
  "stance",
  "heuristic",
  "decision",
  "entity",
  "summary",
  "runbook",
  "index",
];

const KIND_GROUP_LABEL: Record<string, string> = {
  stance: "Stances",
  heuristic: "Heuristics",
  decision: "Decisions",
  entity: "Entities",
  summary: "Summaries",
  runbook: "Runbooks",
  index: "Indices",
};

export function WikiPageList({ pages }: Props): ReactNode {
  if (pages.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[var(--dpf-muted)]">
          No wiki pages yet. The founder kernel seeds when content lands under{" "}
          <code className="text-xs px-1 py-0.5 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]">
            docs/founder-kernel/wiki/
          </code>
          .
        </p>
      </div>
    );
  }

  // Group by pageKind preserving the canonical KIND_ORDER.
  const byKind = new Map<string, WikiPageListItem[]>();
  for (const p of pages) {
    let bucket = byKind.get(p.pageKind);
    if (!bucket) {
      bucket = [];
      byKind.set(p.pageKind, bucket);
    }
    bucket.push(p);
  }

  // Append any unrecognized kinds at the end (defensive).
  const orderedKinds = [
    ...KIND_ORDER.filter((k) => byKind.has(k)),
    ...Array.from(byKind.keys()).filter((k) => !KIND_ORDER.includes(k)),
  ];

  return (
    <div className="space-y-6">
      {orderedKinds.map((kind) => {
        const items = byKind.get(kind) ?? [];
        return (
          <section key={kind}>
            <h2 className="text-xs uppercase tracking-wide text-[var(--dpf-muted)] mb-2">
              {KIND_GROUP_LABEL[kind] ?? kind} · {items.length}
            </h2>
            <ul className="divide-y divide-[var(--dpf-border)] border border-[var(--dpf-border)] rounded">
              {items.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/wiki/${p.slug}`}
                    className="block px-3 py-2 hover:bg-[var(--dpf-surface-2)]"
                  >
                    <div className="flex items-center gap-2">
                      <WikiPageKindBadge pageKind={p.pageKind} />
                      <span className="text-sm font-medium text-[var(--dpf-text)]">
                        {p.title}
                      </span>
                      {!p.isKernel && (
                        <span className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
                          overlay
                        </span>
                      )}
                      {p.status !== "published" && (
                        <span className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
                          · {p.status}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--dpf-muted)] font-mono mt-0.5">
                      {p.slug}
                    </p>
                    {p.abstract && (
                      <p className="text-xs text-[var(--dpf-muted)] mt-1 line-clamp-2">
                        {p.abstract}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
