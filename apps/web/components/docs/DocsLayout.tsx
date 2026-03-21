"use client";

import { DocsSidebar } from "./DocsSidebar";
import { DocsSearch } from "./DocsSearch";
import type { DocHeading, DocsIndex } from "@/lib/docs-types";

type Props = {
  index: DocsIndex;
  currentSlug: string;
  searchItems: Array<{ slug: string; title: string; area: string; content: string }>;
  headings?: DocHeading[];
  children: React.ReactNode;
};

export function DocsLayout({ index, currentSlug, searchItems, headings, children }: Props) {
  const tocHeadings = headings ?? [];

  return (
    <div className="flex gap-6 min-h-[calc(100vh-120px)]">
      {/* Left sidebar — search + area nav */}
      <div className="w-52 shrink-0 hidden lg:block">
        <DocsSearch items={searchItems} />
        <DocsSidebar index={index} currentSlug={currentSlug} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 max-w-3xl">
        {children}
      </div>

      {/* Right sidebar — table of contents */}
      {tocHeadings.length > 0 && (
        <div className="w-44 shrink-0 hidden xl:block">
          <div className="sticky top-6">
            <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest mb-2">On this page</p>
            <nav className="space-y-1">
              {tocHeadings.map((h) => (
                <a
                  key={h.slug}
                  href={`#${h.slug}`}
                  className={[
                    "block text-xs hover:text-[var(--dpf-text)] transition-colors",
                    h.level === 3 ? "pl-3 text-[var(--dpf-muted)]" : "text-[var(--dpf-muted)]",
                  ].join(" ")}
                >
                  {h.text}
                </a>
              ))}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
