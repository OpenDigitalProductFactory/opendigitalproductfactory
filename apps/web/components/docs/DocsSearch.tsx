"use client";

import { useState, useMemo } from "react";
import Fuse from "fuse.js";
import Link from "next/link";

type SearchItem = {
  slug: string;
  title: string;
  area: string;
  content: string;
};

type Props = {
  items: SearchItem[];
};

export function DocsSearch({ items }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: [
          { name: "title", weight: 2 },
          { name: "content", weight: 1 },
        ],
        threshold: 0.4,
        includeMatches: true,
      }),
    [items],
  );

  const results = query.length >= 2 ? fuse.search(query, { limit: 8 }) : [];

  return (
    <div className="relative mb-4">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Search docs..."
        className="w-full px-3 py-1.5 text-xs rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
      />
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-md shadow-lg z-50 max-h-64 overflow-y-auto">
          {results.map((r) => (
            <Link
              key={r.item.slug}
              href={`/docs/${r.item.slug}`}
              className="block px-3 py-2 text-xs hover:bg-[var(--dpf-surface-2)] transition-colors"
            >
              <span className="text-[var(--dpf-text)] font-medium">{r.item.title}</span>
              <span className="text-[var(--dpf-muted)] ml-2">{r.item.area}</span>
            </Link>
          ))}
        </div>
      )}
      {open && query.length >= 2 && results.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-md shadow-lg z-50 p-3">
          <p className="text-xs text-[var(--dpf-muted)]">No results found.</p>
        </div>
      )}
    </div>
  );
}
