// EP-WIKI-001 Phase 6a: page detail viewer.
// Displays a wiki page's metadata header (title, kind, kernel/overlay
// origin, citations count, last reviewed) above its rendered body.
// Server component.

import Link from "next/link";
import type { ReactNode } from "react";

import { WikiBodyRenderer } from "./WikiBodyRenderer";
import { WikiPageKindBadge } from "./WikiPageKindBadge";
import { WikiSourceCitations, type WikiSourceCitation } from "./WikiSourceCitations";

export type WikiPageDetail = {
  id: string;
  slug: string;
  title: string;
  body: string;
  pageKind: string;
  status: string;
  isKernel: boolean;
  kernelVersion: string | null;
  organizationId: string | null;
  kernelPageId: string | null;
  derivedFromKernelVersion: string | null;
  abstract: string | null;
  lastReviewedAt: Date | null;
  updatedAt: Date;
  sources: WikiSourceCitation[];
};

type Props = {
  page: WikiPageDetail;
};

function formatOrigin(page: WikiPageDetail): string {
  if (page.isKernel) {
    return page.kernelVersion ? `Kernel · v${page.kernelVersion}` : "Kernel";
  }
  if (page.kernelPageId) {
    return page.derivedFromKernelVersion
      ? `Org overlay (overrides kernel v${page.derivedFromKernelVersion})`
      : "Org overlay";
  }
  return "Org-original";
}

export function WikiPageViewer({ page }: Props): ReactNode {
  return (
    <article className="max-w-3xl mx-auto py-6 px-4">
      <nav className="mb-3 text-xs text-[var(--dpf-muted)]">
        <Link href="/wiki" className="hover:underline">
          ← Wiki
        </Link>
      </nav>

      <header className="mb-6 pb-4 border-b border-[var(--dpf-border)]">
        <div className="flex items-center gap-2 mb-2">
          <WikiPageKindBadge pageKind={page.pageKind} />
          <span className="text-xs text-[var(--dpf-muted)]">{formatOrigin(page)}</span>
          {page.status !== "published" && (
            <span className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">
              · {page.status}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)] mb-1">
          {page.title}
        </h1>
        <p className="text-xs text-[var(--dpf-muted)] font-mono">{page.slug}</p>
        {page.abstract && (
          <p className="mt-3 text-sm text-[var(--dpf-text)] leading-relaxed">
            {page.abstract}
          </p>
        )}
      </header>

      <section className="mb-8">
        <WikiBodyRenderer body={page.body} />
      </section>

      <aside className="border-t border-[var(--dpf-border)] pt-4 mt-8">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-2">Sources</h2>
        <WikiSourceCitations sources={page.sources} />
      </aside>

      <footer className="mt-6 text-xs text-[var(--dpf-muted)]">
        {page.lastReviewedAt && (
          <span>Last reviewed {page.lastReviewedAt.toISOString().slice(0, 10)} · </span>
        )}
        Updated {page.updatedAt.toISOString().slice(0, 10)}
      </footer>
    </article>
  );
}
