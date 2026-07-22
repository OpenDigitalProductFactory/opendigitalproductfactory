"use client";

import Link from "next/link";
import { AREA_META, AREA_ORDER, type DocsIndex } from "@/lib/docs-types";

type Props = {
  index: DocsIndex;
  currentSlug: string;
  /** Demote the full area list into a collapsed disclosure (contextual arrival). */
  collapsible?: boolean;
};

export function DocsSidebar({ index, currentSlug, collapsible = false }: Props) {
  const currentArea = currentSlug.split("/")[0] ?? "";

  const areaList = AREA_ORDER.map((areaKey) => {
        const meta = AREA_META[areaKey];
        if (!meta) return null;
        const pages = index[areaKey];
        if (!pages || pages.length === 0) return null;
        const isCurrentArea = currentArea === areaKey;

        return (
          <div key={areaKey}>
            <p
              className={[
                "text-[10px] uppercase tracking-widest mb-1",
                isCurrentArea ? "text-[var(--dpf-accent)]" : "text-[var(--dpf-muted)]",
              ].join(" ")}
            >
              {meta.label}
            </p>
            <ul className="space-y-0.5">
              {pages.map((page) => {
                const isActive = currentSlug === page.slug;
                return (
                  <li key={page.slug}>
                    <Link
                      href={`/docs/${page.slug}`}
                      className={[
                        "block text-xs py-0.5 px-2 rounded transition-colors",
                        isActive
                          ? "text-[var(--dpf-text)] bg-[var(--dpf-surface-2)]"
                          : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
                      ].join(" ")}
                    >
                      {page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      });

  const allDocsLink = (
    <Link
      href="/docs"
      className="block text-xs font-semibold text-[var(--dpf-accent)] hover:underline"
    >
      All Docs
    </Link>
  );

  if (collapsible) {
    return (
      <nav className="sticky top-6 space-y-3">
        {allDocsLink}
        <details className="rounded border border-[var(--dpf-border)]">
          <summary className="cursor-pointer px-2 py-1.5 text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Browse all areas
          </summary>
          <div className="space-y-4 px-2 py-2">{areaList}</div>
        </details>
      </nav>
    );
  }

  return (
    <nav className="sticky top-6 space-y-4">
      <div className="mb-3">{allDocsLink}</div>
      {areaList}
    </nav>
  );
}
