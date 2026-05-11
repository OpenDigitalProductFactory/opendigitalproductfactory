// EP-WIKI-001 Phase 6a: list of cited raw sources for a wiki page.
// Renders the WikiPageSource → RawSource join into a dense list of
// chips. Each source links out to its `url` if present; otherwise the
// title is shown plain. Server component; no client JS.

import type { ReactNode } from "react";

export type WikiSourceCitation = {
  id: string;
  sourceKey: string;
  sourceType: string;
  title: string;
  authors: string[];
  url: string | null;
  publishedAt: Date | null;
};

type Props = {
  sources: WikiSourceCitation[];
};

export function WikiSourceCitations({ sources }: Props): ReactNode {
  if (sources.length === 0) {
    return (
      <p className="text-xs text-[var(--dpf-muted)] italic">No sources cited.</p>
    );
  }

  return (
    <ul className="text-xs space-y-1">
      {sources.map((s) => {
        const yearText = s.publishedAt ? ` (${s.publishedAt.getFullYear()})` : "";
        const authorText = s.authors.length > 0 ? `${s.authors.join(", ")}. ` : "";
        const inner = (
          <>
            <span className="text-[var(--dpf-muted)] mr-1">[{s.sourceType}]</span>
            {authorText}
            <span className="text-[var(--dpf-text)]">{s.title}</span>
            {yearText}
          </>
        );
        return (
          <li key={s.id} className="text-[var(--dpf-text)]">
            {s.url ? (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {inner}
              </a>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}
